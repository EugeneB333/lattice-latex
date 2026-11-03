import { afterEach, describe, expect, it, vi } from "vitest";
import { demoProject, demoSource } from "../demo";
import {
  askAi,
  chooseProject,
  compileProject,
  detectEngines,
  forwardSearch,
  inverseSearch,
  isDesktop,
  openBuiltPdf,
  printBuiltPdf,
  readFile,
  readProject,
  readStarterProject,
  renderPdfPage,
  saveFileAs,
  subscribeToDesktopMenu,
  updateNativeRecentProjects,
  writeFile,
} from "./desktop";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser demo contract", () => {
  it("detects desktop mode only when an invoke function is exposed", () => {
    expect(isDesktop()).toBe(false);
    vi.stubGlobal("window", { lattice: {} });
    expect(isDesktop()).toBe(false);
    vi.stubGlobal("window", { lattice: { invoke: vi.fn() } });
    expect(isDesktop()).toBe(true);
  });

  it("provides deterministic engine and project fallbacks", async () => {
    await expect(detectEngines()).resolves.toEqual([
      { id: "pdflatex", label: "pdfLaTeX", available: true, path: "/usr/bin/pdflatex" },
      { id: "xelatex", label: "XeLaTeX", available: true, path: "/usr/bin/xelatex" },
      { id: "lualatex", label: "LuaLaTeX", available: true, path: "/usr/bin/lualatex" },
    ]);
    await expect(chooseProject()).resolves.toEqual(demoProject);
    await expect(readStarterProject()).resolves.toEqual(demoProject);
    await expect(readProject("/ignored")).resolves.toEqual(demoProject);
  });

  it("reads only the demo main source and treats browser writes as no-ops", async () => {
    await expect(readFile(demoProject.root, "main.tex")).resolves.toBe(demoSource);
    await expect(readFile(demoProject.root, "references.bib")).resolves.toBe("");
    await expect(writeFile(demoProject.root, "main.tex", "changed")).resolves.toBeUndefined();
    await expect(saveFileAs(demoProject.root, "main.tex", "main.tex", "changed")).resolves.toBeNull();
    await expect(updateNativeRecentProjects([{ root: "/one", name: "One" }])).resolves.toBeUndefined();
    vi.stubGlobal("window", {});
    expect(() => subscribeToDesktopMenu(vi.fn())()).not.toThrow();
  });

  it("returns a delayed successful demo build for every engine", async () => {
    vi.useFakeTimers();
    for (const engine of ["pdflatex", "xelatex", "lualatex"] as const) {
      const promise = compileProject("browser-project", "main.tex", engine);
      await vi.advanceTimersByTimeAsync(900);
      await expect(promise).resolves.toMatchObject({ success: true, engine, durationMs: 914, diagnostics: [] });
    }
  });

  it("rejects desktop-only PDF and SyncTeX operations", async () => {
    await expect(openBuiltPdf("/paper", "main.tex")).rejects.toThrow("desktop app");
    await expect(printBuiltPdf("/paper", "main.tex")).rejects.toThrow("desktop app");
    await expect(forwardSearch("/paper", "main.tex", "main.tex", 1, 1)).rejects.toThrow("desktop app");
    await expect(inverseSearch("/paper", "main.tex", 1, 2, 3)).rejects.toThrow("desktop app");
    await expect(renderPdfPage("/paper", "main.tex", "version", 1)).rejects.toThrow("desktop app");
  });

  it("returns unchanged prose for a generic demo AI request", async () => {
    vi.useFakeTimers();
    const promise = askAi({ root: demoProject.root, path: "main.tex", source: "Original", prompt: "Keep this", diagnostics: [] });
    await vi.advanceTimersByTimeAsync(700);
    await expect(promise).resolves.toMatchObject({ replacement: "Original", mode: "demo", summary: "Refine the selected prose" });
  });

  it("uses the selected text and tempers absolute academic claims", async () => {
    vi.useFakeTimers();
    const promise = askAi({
      root: demoProject.root,
      path: "main.tex",
      source: "whole document",
      prompt: "Make the claim academically cautious",
      selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 36, text: "These results clearly prove and always produce gains." },
      diagnostics: [],
    });
    await vi.advanceTimersByTimeAsync(700);
    await expect(promise).resolves.toMatchObject({
      replacement: "These results suggest and can produce gains.",
      summary: "Temper the strength of the claim",
      mode: "demo",
    });
  });
});

describe("desktop command routing", () => {
  it("routes every simple bridge operation with its exact command and arguments", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("window", { lattice: { invoke } });

    await detectEngines();
    await chooseProject();
    await readProject("/paper");
    await readFile("/paper", "chapter.tex");
    await writeFile("/paper", "chapter.tex", "text");
    await forwardSearch("/paper", "main.tex", "chapter.tex", 7, 8);
    await inverseSearch("/paper", "main.tex", 2, 12.5, 15.75);
    await renderPdfPage("/paper", "main.tex", "build-7", 3);
    await askAi({ root: "/paper", path: "chapter.tex", source: "text", prompt: "edit", diagnostics: [] });

    expect(invoke.mock.calls).toEqual([
      ["detect_engines", undefined],
      ["choose_project", undefined],
      ["read_project", { root: "/paper" }],
      ["read_project_file", { root: "/paper", path: "chapter.tex" }],
      ["write_project_file", { root: "/paper", path: "chapter.tex", content: "text" }],
      ["forward_search", { root: "/paper", rootDocument: "main.tex", path: "chapter.tex", line: 7, column: 8 }],
      ["inverse_search", { root: "/paper", rootDocument: "main.tex", page: 2, x: 12.5, y: 15.75 }],
      ["render_pdf_page", { root: "/paper", rootDocument: "main.tex", pdfVersion: "build-7", page: 3 }],
      ["propose_ai_edit", { request: { root: "/paper", path: "chapter.tex", source: "text", prompt: "edit", diagnostics: [] } }],
    ]);
  });

  it("propagates bridge failures without rewriting them", async () => {
    const failure = new Error("backend unavailable");
    vi.stubGlobal("window", { lattice: { invoke: vi.fn().mockRejectedValue(failure) } });
    await expect(readProject("/paper")).rejects.toBe(failure);
  });
});

describe("compileProject", () => {
  it("does not send the browser demo path to the desktop backend", async () => {
    const invoke = vi.fn();
    vi.stubGlobal("window", { lattice: { invoke } });

    await expect(
      compileProject(demoProject.root, demoProject.rootDocument, "lualatex"),
    ).rejects.toThrow("Open a local project before building");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("marks live-preview compiles as background work", async () => {
    const result = { success: true, durationMs: 50, engine: "lualatex", diagnostics: [], log: "" };
    const invoke = vi.fn().mockResolvedValue(result);
    vi.stubGlobal("window", { lattice: { invoke } });

    await expect(compileProject("/documents/paper", "main.tex", "lualatex", true)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("compile_project", {
      root: "/documents/paper",
      rootDocument: "main.tex",
      engine: "lualatex",
      background: true,
    });
  });
});

describe("readStarterProject", () => {
  it("loads the persistent desktop starter project", async () => {
    const project = { ...demoProject, root: "/app-data/reliable-documents" };
    const invoke = vi.fn().mockResolvedValue(project);
    vi.stubGlobal("window", { lattice: { invoke } });

    await expect(readStarterProject()).resolves.toEqual(project);
    expect(invoke).toHaveBeenCalledWith("read_starter_project", undefined);
  });
});

describe("desktop file operations", () => {
  it("routes Save As through the protected desktop bridge", async () => {
    const result = { project: { ...demoProject, root: "/documents/paper" }, path: "copy.tex" };
    const invoke = vi.fn().mockResolvedValue(result);
    vi.stubGlobal("window", { lattice: { invoke } });

    await expect(saveFileAs("/documents/paper", "main.tex", "main.tex", "source")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("save_project_file_as", {
      root: "/documents/paper",
      path: "main.tex",
      rootDocument: "main.tex",
      content: "source",
    });
  });

  it("routes PDF viewing and printing without sending PDF data through the renderer bridge", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { lattice: { invoke } });

    await openBuiltPdf("/documents/paper", "main.tex");
    await printBuiltPdf("/documents/paper", "main.tex");

    expect(invoke).toHaveBeenNthCalledWith(1, "open_built_pdf", {
      root: "/documents/paper",
      rootDocument: "main.tex",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "print_built_pdf", {
      root: "/documents/paper",
      rootDocument: "main.tex",
    });
  });

  it("synchronizes recent projects and subscribes to the native application menu", async () => {
    const cleanup = vi.fn();
    const onMenuAction = vi.fn().mockReturnValue(cleanup);
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { lattice: { invoke, onMenuAction } });
    const callback = vi.fn();
    const recent = [{ root: "/documents/paper", name: "Paper" }];

    await updateNativeRecentProjects(recent);
    const unsubscribe = subscribeToDesktopMenu(callback);

    expect(invoke).toHaveBeenCalledWith("set_recent_projects", { recent });
    expect(onMenuAction).toHaveBeenCalledWith(callback);
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
