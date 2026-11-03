// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: pdfjs.getDocument,
  GlobalWorkerOptions: pdfjs.workerOptions,
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "/assets/pdf.worker.mjs" }));

import { loadPdfDocument } from "./pdfDocument";

beforeEach(() => {
  pdfjs.getDocument.mockReset();
  pdfjs.workerOptions.workerSrc = "";
});

describe("loadPdfDocument", () => {
  it("decodes the PDF, configures the worker, and exposes page rendering", async () => {
    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const render = vi.fn(() => renderTask);
    const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: 200 * scale, height: 300 * scale }));
    const getPage = vi.fn(async () => ({ getViewport, render }));
    const destroy = vi.fn(async () => undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
      destroy,
    });

    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(pdfjs.workerOptions.workerSrc).toBe("/assets/pdf.worker.mjs");
    expect([...pdfjs.getDocument.mock.calls[0][0].data]).toEqual([80, 68, 70]);
    expect(document.numPages).toBe(1);
    const page = await document.getPage(1);
    expect(page.size()).toEqual({ width: 200, height: 300 });
    const canvas = documentOwnerCanvas();
    expect(page.render(canvas, 2)).toBe(renderTask);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(600);
    expect(render).toHaveBeenCalledWith({ canvas, viewport: { width: 400, height: 600 } });
    document.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

function documentOwnerCanvas() {
  return window.document.createElement("canvas");
}

function linkedDocument(annotations: unknown[] = []) {
  const viewport = {
    width: 600, height: 800,
    convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
  };
  const page = {
    view: [0, 0, 600, 800],
    getViewport: vi.fn(() => viewport),
    getAnnotations: vi.fn(async () => annotations),
  };
  const proxy = {
    numPages: 3,
    getPage: vi.fn(async () => page),
    getDestination: vi.fn(async () => [{ num: 7, gen: 0 }, { name: "XYZ" }, 72, 640, null]),
    getPageIndex: vi.fn(async () => 1),
  };
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve(proxy), destroy: vi.fn() });
  return { page, proxy, viewport };
}

describe("PDF internal links", () => {
  it("loads only internal links, transforms and normalizes their hit rectangles", async () => {
    linkedDocument([
      { subtype: "Link", rect: [200, 680, 50, 700], dest: "section.2" },
      { subtype: "Link", rect: [20, 600, 30, 610], dest: [0, { name: "Fit" }] },
      { subtype: "Link", rect: [1, 2, 3, 4], url: "https://example.org" },
      { subtype: "Link", rect: [1, 2, 3, 4], action: "NextPage" },
      { subtype: "Text", rect: [1, 2, 3, 4], dest: "section.2" },
      { subtype: "Link", rect: [1, NaN, 3, 4], dest: "section.2" },
      { subtype: "Link", rect: [1, 2], dest: "section.2" },
      { subtype: "Link", rect: [1, 2, 3, 4], dest: {} },
      { subtype: "Link", rect: [1, 2, 3, 4], dest: "" },
    ]);
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect((await document.getPage(1)).links).toEqual([
      { rect: [50, 100, 200, 120], destination: "section.2" },
      { rect: [20, 190, 30, 200], destination: [0, { name: "Fit" }] },
    ]);
  });

  it("keeps rendering available when annotations cannot be read", async () => {
    const { page } = linkedDocument();
    page.getAnnotations.mockRejectedValue(new Error("broken annotations"));
    const document = await loadPdfDocument(window.btoa("PDF"));
    const handle = await document.getPage(1);
    expect(handle.links).toEqual([]);
    expect(handle.size()).toEqual({ width: 600, height: 800 });
  });

  it("resolves named destinations and indirect page references", async () => {
    const { proxy } = linkedDocument();
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(await document.resolveDestination("section.2")).toEqual({ page: 2, x: 72, y: 160 });
    expect(proxy.getDestination).toHaveBeenCalledWith("section.2");
    expect(proxy.getPageIndex).toHaveBeenCalledWith({ num: 7, gen: 0 });
    expect(proxy.getPage).toHaveBeenCalledWith(2);
  });

  it.each([
    [[0, { name: "XYZ" }, 72, 640, null], { page: 1, x: 72, y: 160 }],
    [[2, { name: "XYZ" }, null, null, null], { page: 3, x: 0, y: 0 }],
    [[0, { name: "FitH" }, 640], { page: 1, x: 0, y: 160 }],
    [[0, { name: "FitBH" }, null], { page: 1, x: 0, y: 0 }],
    [[0, { name: "FitV" }, 72], { page: 1, x: 72, y: 0 }],
    [[0, { name: "FitBV" }, null], { page: 1, x: 0, y: 0 }],
    [[0, { name: "Fit" }], { page: 1, x: 0, y: 0 }],
    [[0, { name: "FitB" }], { page: 1, x: 0, y: 0 }],
    [[0, { name: "FitR" }, 72, 600, 300, 640], { page: 1, x: 72, y: 160 }],
    [[0, { name: "XYZ" }, -10, 900, null], { page: 1, x: 0, y: 0 }],
  ])("resolves explicit destinations %j", async (destination, expected) => {
    const { proxy } = linkedDocument();
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(await document.resolveDestination(destination as unknown[])).toEqual(expected);
    expect(proxy.getDestination).not.toHaveBeenCalled();
    expect(proxy.getPageIndex).not.toHaveBeenCalled();
  });

  it.each([
    [], [0], [-1, { name: "Fit" }], [3, { name: "Fit" }], [0.5, { name: "Fit" }],
    [null, { name: "Fit" }], [{}, { name: "Fit" }], [0, null], [0, { name: "unknown" }],
    [0, { name: "XYZ" }, "72", 640, null], [0, { name: "XYZ" }, 72, Infinity, null],
    [0, { name: "XYZ" }], [0, { name: "FitH" }, NaN], [0, { name: "FitV" }, "x"],
    [0, { name: "FitR" }, 72, 600, 300, null],
  ])("rejects malformed or out-of-range destinations %j", async (...destination) => {
    linkedDocument();
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(await document.resolveDestination(destination)).toBeUndefined();
  });

  it("returns no match for a missing named destination", async () => {
    const { proxy } = linkedDocument();
    proxy.getDestination.mockResolvedValue(null as never);
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(await document.resolveDestination("missing")).toBeUndefined();
  });

  it("uses the destination page's viewport for rotated and cropped pages", async () => {
    const { page, viewport } = linkedDocument();
    page.view = [10, 20, 610, 820];
    viewport.convertToViewportPoint = (x, y) => [y - 20, x - 10];
    const document = await loadPdfDocument(window.btoa("PDF"));
    expect(await document.resolveDestination([0, { name: "XYZ" }, 82, 660, null])).toEqual({ page: 1, x: 640, y: 72 });
  });
});
