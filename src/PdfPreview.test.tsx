// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPdfDocument, type PdfDocumentHandle, type PdfPageHandle } from "./lib/pdfDocument";
import { PdfPreview } from "./PdfPreview";
import { cleanupRoots, click, flush, render } from "./test/render";

vi.mock("./lib/pdfDocument", () => ({ loadPdfDocument: vi.fn() }));

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  target?: Element;
  disconnect: ReturnType<typeof vi.fn>;
}

const roots: Array<{ unmount: () => void }> = [];
let observers: ObserverRecord[] = [];

function page(width: number, height: number) {
  const cancel = vi.fn();
  const handle: PdfPageHandle = {
    links: [],
    size: () => ({ width, height }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel })),
  };
  return { handle, cancel };
}

function documentWith(...pages: PdfPageHandle[]) {
  const document: PdfDocumentHandle = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber) => pages[pageNumber - 1]),
    destroy: vi.fn(),
    resolveDestination: vi.fn(async () => undefined),
  };
  return document;
}

function preview(
  pdfBase64 = "pdf",
  zoom = 100,
  target?: { page: number; x: number; y: number; width: number; height: number },
  onNavigate = vi.fn(),
  loadPageImage?: (page: number) => Promise<string>,
  onEditTable = vi.fn(),
) {
  return (
    <div className="preview-canvas">
      <PdfPreview pdfBase64={pdfBase64} zoom={zoom} target={target} onNavigate={onNavigate} onEditTable={onEditTable} loadPageImage={loadPageImage} />
    </div>
  );
}

async function load(view: ReturnType<typeof render>) {
  await flush();
  await flush();
  expect(view.container.querySelector(".pdf-document")).not.toBeNull();
}

function reveal(pageIndex: number) {
  const observer = observers[pageIndex];
  act(() => observer.callback([{ isIntersecting: true, target: observer.target } as IntersectionObserverEntry], {} as IntersectionObserver));
}

beforeEach(() => {
  observers = [];
  class FakeIntersectionObserver {
    record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = { callback, options, disconnect: vi.fn() };
      observers.push(this.record);
    }
    observe = (target: Element) => { this.record.target = target; };
    disconnect = () => this.record.disconnect();
    unobserve = vi.fn();
    takeRecords = () => [];
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanupRoots(roots);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PdfPreview", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }])("navigates contents links to their section before source lookup (%o)", async (modifier) => {
    const first = page(600, 800);
    first.handle.links = [{ rect: [50, 100, 200, 120], destination: "section.2" }];
    const pdf = documentWith(first.handle, page(600, 800).handle);
    vi.mocked(pdf.resolveDestination).mockResolvedValue({ page: 2, x: 72, y: 160 });
    vi.mocked(loadPdfDocument).mockResolvedValue(pdf);
    const onNavigate = vi.fn();
    const view = render(preview("pdf", 200, undefined, onNavigate));
    roots.push(view);
    await load(view);
    const element = view.container.querySelector(".pdf-page")!;
    click(element, { clientX: 150, clientY: 220 });
    expect(pdf.resolveDestination).not.toHaveBeenCalled();
    click(element, { clientX: 150, clientY: 220, ...modifier });
    await flush();
    expect(pdf.resolveDestination).toHaveBeenCalledWith("section.2");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(2, 72, 160);
    click(element, { clientX: 500, clientY: 500, ...modifier });
    expect(onNavigate).toHaveBeenLastCalledWith(1, 250, 250);
  });

  it.each(["missing", "error"])("preserves ordinary source navigation for a %s link destination", async (failure) => {
    const first = page(600, 800);
    first.handle.links = [{ rect: [50, 100, 200, 120], destination: "missing" }];
    const pdf = documentWith(first.handle);
    if (failure === "error") vi.mocked(pdf.resolveDestination).mockRejectedValue(new Error("bad destination"));
    vi.mocked(loadPdfDocument).mockResolvedValue(pdf);
    const onNavigate = vi.fn();
    const view = render(preview("pdf", 100, undefined, onNavigate));
    roots.push(view);
    await load(view);
    click(view.container.querySelector(".pdf-page")!, { clientX: 75, clientY: 110, ctrlKey: true });
    await flush();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1, 75, 110);
    expect(view.container.querySelector(".preview-error")).toBeNull();
  });

  it.each(["click", "replace", "unmount"])("ignores pending link navigation after a newer %s", async (action) => {
    const first = page(600, 800);
    first.handle.links = [{ rect: [50, 100, 200, 120], destination: "section.2" }];
    const pdf = documentWith(first.handle);
    let resolve!: (value: { page: number; x: number; y: number }) => void;
    vi.mocked(pdf.resolveDestination).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(loadPdfDocument).mockResolvedValue(pdf);
    const onNavigate = vi.fn();
    const view = render(preview("pdf", 100, undefined, onNavigate));
    roots.push(view);
    await load(view);
    const element = view.container.querySelector(".pdf-page")!;
    click(element, { clientX: 75, clientY: 110, ctrlKey: true });
    if (action === "click") click(element, { clientX: 300, clientY: 300, ctrlKey: true });
    if (action === "replace") {
      vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(page(600, 800).handle));
      view.rerender(preview("new", 100, undefined, onNavigate));
      await load(view);
    }
    if (action === "unmount") { view.unmount(); roots.pop(); }
    await act(async () => resolve({ page: 2, x: 72, y: 160 }));
    if (action === "click") expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1, 300, 300);
    else expect(onNavigate).not.toHaveBeenCalled();
  });

  it("loads page geometry but renders only pages near the viewport", async () => {
    const first = page(600, 800);
    const second = page(300, 400);
    const pdf = documentWith(first.handle, second.handle);
    vi.mocked(loadPdfDocument).mockResolvedValue(pdf);
    const view = render(preview());
    roots.push(view);

    expect(view.container.textContent).toContain("Preparing PDF preview");
    await load(view);
    const renderedPages = view.container.querySelectorAll<HTMLElement>(".pdf-page");
    expect(renderedPages).toHaveLength(2);
    expect(renderedPages[0].style.width).toBe("600px");
    expect(renderedPages[1].style.height).toBe("400px");
    expect(first.handle.render).not.toHaveBeenCalled();
    expect(second.handle.render).not.toHaveBeenCalled();
    expect(observers[0].options).toMatchObject({ rootMargin: "1200px 0px" });

    reveal(0);
    expect(first.handle.render).toHaveBeenCalledOnce();
    expect(first.handle.render).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 2);
    expect(second.handle.render).not.toHaveBeenCalled();
  });

  it("rerenders visible pages at the selected zoom and cancels stale work", async () => {
    const first = page(600, 800);
    const pdf = documentWith(first.handle);
    vi.mocked(loadPdfDocument).mockResolvedValue(pdf);
    const view = render(preview("pdf", 100));
    roots.push(view);
    await load(view);
    reveal(0);

    view.rerender(preview("pdf", 150));
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(first.handle.render).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), 3);
    expect((view.container.querySelector(".pdf-page") as HTMLElement).style.width).toBe("900px");
  });

  it("uses a lazy native SVG page without invoking the browser font renderer", async () => {
    const first = page(600, 800);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle));
    const loadPageImage = vi.fn(async () => "PHN2Zy8+");
    const view = render(preview("pdf", 100, undefined, vi.fn(), loadPageImage));
    roots.push(view);
    await load(view);

    expect(loadPageImage).not.toHaveBeenCalled();
    expect(view.container.querySelector("canvas")).toBeNull();
    reveal(0);
    await flush();
    expect(loadPageImage).toHaveBeenCalledExactlyOnceWith(1);
    expect(first.handle.render).not.toHaveBeenCalled();
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,PHN2Zy8+");

    view.rerender(preview("pdf", 150, undefined, vi.fn(), loadPageImage));
    expect(loadPageImage).toHaveBeenCalledOnce();
    expect((view.container.querySelector("img") as HTMLElement).style.width).toBe("900px");
  });

  it("reports native page-rendering failures without falling back to substituted fonts", async () => {
    const first = page(600, 800);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle));
    const view = render(preview("pdf", 100, undefined, vi.fn(), async () => { throw new Error("Poppler failed"); }));
    roots.push(view);
    await load(view);
    reveal(0);
    await flush();

    expect(view.container.textContent).toContain("Could not render page 1");
    expect(first.handle.render).not.toHaveBeenCalled();
  });

  it("preserves native sharpness above the minimum preview pixel ratio", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const first = page(600, 800);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle));
    const view = render(preview("pdf", 100));
    roots.push(view);
    await load(view);
    reveal(0);

    expect(first.handle.render).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 3);
  });

  it("navigates only on Ctrl/meta clicks and converts pixels to PDF points", async () => {
    const first = page(600, 800);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle));
    const onNavigate = vi.fn();
    const view = render(preview("pdf", 200, undefined, onNavigate));
    roots.push(view);
    await load(view);
    const pageElement = view.container.querySelector(".pdf-page") as HTMLElement;
    pageElement.getBoundingClientRect = () => ({ left: 10, top: 20, right: 1210, bottom: 1620, width: 1200, height: 1600, x: 10, y: 20, toJSON: () => ({}) });

    click(pageElement, { clientX: 210, clientY: 420 });
    click(pageElement, { clientX: 210, clientY: 420, ctrlKey: true });
    click(pageElement, { clientX: 110, clientY: 220, metaKey: true });
    expect(onNavigate).toHaveBeenNthCalledWith(1, 1, 100, 200);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 1, 50, 100);
  });

  it("uses Shift-click for table editing without triggering ordinary SyncTeX navigation", async () => {
    const first = page(600, 800);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle));
    const onNavigate = vi.fn();
    const onEditTable = vi.fn();
    const view = render(preview("pdf", 200, undefined, onNavigate, undefined, onEditTable));
    roots.push(view);
    await load(view);
    const pageElement = view.container.querySelector(".pdf-page") as HTMLElement;
    pageElement.getBoundingClientRect = () => ({ left: 10, top: 20, right: 1210, bottom: 1620, width: 1200, height: 1600, x: 10, y: 20, toJSON: () => ({}) });

    click(pageElement, { clientX: 210, clientY: 420, shiftKey: true });
    click(pageElement, { clientX: 410, clientY: 620, ctrlKey: true, shiftKey: true });
    expect(onEditTable).toHaveBeenNthCalledWith(1, 1, 100, 200);
    expect(onEditTable).toHaveBeenNthCalledWith(2, 1, 200, 300);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(pageElement.title).toContain("Shift+click");
  });

  it("draws and scrolls to a scaled SyncTeX target", async () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => { callback = next; return 17; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const first = page(600, 800);
    const second = page(300, 400);
    vi.mocked(loadPdfDocument).mockResolvedValue(documentWith(first.handle, second.handle));
    const target = { page: 2, x: 50, y: 60, width: -4, height: 2 };
    const view = render(preview("pdf", 50, target));
    roots.push(view);
    await load(view);
    const marker = view.container.querySelector(".synctex-target") as HTMLElement;
    expect(marker.style.left).toBe("25px");
    expect(marker.style.width).toBe("12px");
    const scroller = view.container.querySelector(".preview-canvas") as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperties(scroller, { clientWidth: { value: 400 }, clientHeight: { value: 300 }, scrollTo: { value: scrollTo } });
    const targetPage = view.container.querySelector('[data-page-number="2"]') as HTMLElement;
    Object.defineProperties(targetPage, { offsetTop: { value: 900 }, offsetLeft: { value: 300 } });

    act(() => callback?.(0));
    expect(scrollTo).toHaveBeenCalledWith({ top: 780, left: 125, behavior: "smooth" });
    view.unmount();
    roots.pop();
    expect(request).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(17);
  });

  it("reports malformed PDFs and destroys documents when replaced or unmounted", async () => {
    vi.mocked(loadPdfDocument).mockRejectedValueOnce(new Error("invalid PDF"));
    const view = render(preview("bad"));
    roots.push(view);
    await flush();
    await flush();
    expect(view.container.textContent).toContain("preview could not be loaded");
    expect(view.container.textContent).toContain("invalid PDF");

    const next = documentWith(page(100, 200).handle);
    vi.mocked(loadPdfDocument).mockResolvedValue(next);
    view.rerender(preview("good"));
    await load(view);
    view.unmount();
    roots.pop();
    expect(next.destroy).toHaveBeenCalledOnce();
  });

  it("destroys a document that finishes loading after the preview is gone", async () => {
    let resolveDocument: ((document: PdfDocumentHandle) => void) | undefined;
    vi.mocked(loadPdfDocument).mockReturnValue(new Promise((resolve) => { resolveDocument = resolve; }));
    const late = documentWith(page(100, 200).handle);
    const view = render(preview("slow"));
    view.unmount();

    await act(async () => resolveDocument?.(late));
    expect(late.destroy).toHaveBeenCalledOnce();
  });
});
