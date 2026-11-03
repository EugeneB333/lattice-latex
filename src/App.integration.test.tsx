// @vitest-environment jsdom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { change, cleanupRoots, click, flush, keydown, render } from "./test/render";

vi.mock("@monaco-editor/react", () => ({
  default: ({ defaultValue, value, onChange, language, theme }: {
    defaultValue?: string;
    value?: string;
    onChange?: (value: string | undefined) => void;
    language?: string;
    theme?: string;
  }) => createElement("textarea", {
    "aria-label": "Mock Monaco editor",
    "data-language": language,
    "data-theme": theme,
    defaultValue,
    value,
    onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
  }),
}));

vi.mock("./PdfPreview", () => ({
  PdfPreview: ({ pdfBase64 }: { pdfBase64: string }) => createElement("div", { "data-testid": "pdf-preview" }, pdfBase64),
}));

import App from "./App";
import { demoSource } from "./demo";
import { loadWorkspaceSession } from "./lib/workspaceSession";
import type { ProjectSnapshot } from "./types";

const roots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  window.localStorage.clear();
  delete window.lattice;
});

afterEach(() => {
  cleanupRoots(roots);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderApp() {
  const view = render(<App />);
  roots.push(view);
  return view;
}

function buttonWithText(container: ParentNode, text: string) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text)) as HTMLButtonElement;
}

describe("App browser workflow", () => {
  it("renders every primary workspace surface and discovers all browser engines", async () => {
    const view = renderApp();
    await flush();
    expect(view.container.querySelector(".titlebar")?.textContent).toContain("Lattice");
    expect(view.container.querySelector(".file-rail")?.textContent).toContain("main.tex");
    expect(view.container.querySelector(".editor-pane")).not.toBeNull();
    expect(view.container.querySelector(".editor-pane")?.closest("[data-dock-zone]")?.getAttribute("data-dock-zone")).toBe("center");
    expect(view.container.querySelector(".preview-pane")?.textContent).toContain("Preview");
    expect(view.container.querySelector(".ai-panel")).not.toBeNull();
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Interactive preview");
    expect([...view.container.querySelectorAll<HTMLSelectElement>('[aria-label="LaTeX engine"] option')].map((option) => option.value)).toEqual([
      "pdflatex", "xelatex", "lualatex",
    ]);
    expect((view.container.querySelector('[aria-label="LaTeX engine"]') as HTMLSelectElement).value).toBe("pdflatex");
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("pdfLaTeX");
  });

  it("moves, swaps, resizes, and restores docked workspace panes", async () => {
    const view = renderApp();
    await flush();
    const zoneFor = (selector: string) => view.container.querySelector(selector)?.closest("[data-dock-zone]")?.getAttribute("data-dock-zone");
    const chooseDock = (pane: string, slot: string) => {
      click(view.container.querySelector(`[aria-label="Move ${pane} pane"]`)!);
      click(view.container.querySelector(`.dock-drop-target.${slot}`)!);
    };

    expect(zoneFor(".file-rail")).toBe("left");
    expect(zoneFor(".editor-pane")).toBe("center");
    expect(zoneFor(".preview-pane")).toBe("right");
    expect(zoneFor(".ai-panel")).toBe("right");

    click(view.container.querySelector('[aria-label="Move Navigator pane"]')!);
    expect(view.container.querySelector(".dock-drop-overlay")).not.toBeNull();
    keydown(window, "Escape");
    expect(view.container.querySelector(".dock-drop-overlay")).toBeNull();
    expect(zoneFor(".file-rail")).toBe("left");
    chooseDock("Navigator", "bottom-right");
    expect(zoneFor(".file-rail")).toBe("bottom");
    expect(view.container.querySelector(".dock-drop-overlay")).toBeNull();
    chooseDock("Navigator", "left-top");

    const rightBoundary = view.container.querySelector('[aria-label="Resize right dock"]')!;
    keydown(rightBoundary, "ArrowLeft");
    expect(rightBoundary.getAttribute("aria-valuenow")).toBe("406");
    act(() => rightBoundary.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 500 })));
    act(() => window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 480 })));
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 480 })));
    expect(rightBoundary.getAttribute("aria-valuenow")).toBe("426");
    const rightSplit = view.container.querySelector('[aria-label="Resize right dock panes"]')!;
    keydown(rightSplit, "ArrowDown");
    expect(rightSplit.getAttribute("aria-valuenow")).toBe("58");

    chooseDock("Preview", "bottom-left");
    expect(zoneFor(".preview-pane")).toBe("bottom");
    chooseDock("Navigator", "right-bottom");
    expect(zoneFor(".file-rail")).toBe("right");
    expect(zoneFor(".ai-panel")).toBe("left");

    const saved = JSON.parse(window.localStorage.getItem("lattice-workspace-layout")!);
    expect(saved.placements).toEqual({ navigator: "right-bottom", editor: "center-left", preview: "bottom-left", ai: "left-top" });
    expect(saved.sizes.right).toBe(426);
    expect(saved.splits.right).toBe(58);

    roots.pop()?.unmount();
    const restored = renderApp();
    await flush();
    expect(restored.container.querySelector(".preview-pane")?.closest("[data-dock-zone]")?.getAttribute("data-dock-zone")).toBe("bottom");
    expect(restored.container.querySelector(".file-rail")?.closest("[data-dock-zone]")?.getAttribute("data-dock-zone")).toBe("right");
  });

  it("drags a pane directly from its header into a visible dock target", async () => {
    const view = renderApp();
    await flush();
    const navigatorHeader = view.container.querySelector(".file-rail .rail-top")!;

    act(() => navigatorHeader.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 30, clientY: 70 })));
    act(() => window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 70, clientY: 110 })));
    const target = view.container.querySelector<HTMLElement>(".dock-drop-target.bottom-left");
    expect(target).not.toBeNull();

    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 70, clientY: 700 })));
    expect(view.container.querySelector(".file-rail")?.closest("[data-dock-zone]")?.getAttribute("data-dock-zone")).toBe("bottom");
    expect(view.container.querySelector(".dock-drop-overlay")).toBeNull();
  });

  it("drags the editor between two optional centre slots and leaves unused slots empty", async () => {
    const view = renderApp();
    await flush();
    const editorHeader = view.container.querySelector(".editor-pane .editor-tabs")!;

    act(() => editorHeader.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 400, clientY: 70 })));
    act(() => window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 450, clientY: 110 })));
    expect(view.container.querySelectorAll(".dock-drop-target")).toHaveLength(8);
    const target = view.container.querySelector<HTMLElement>(".dock-drop-target.center-right");
    expect(target).not.toBeNull();

    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 760, clientY: 260 })));
    const editorDock = view.container.querySelector(".editor-pane")?.closest("[data-dock-slot]");
    expect(editorDock?.getAttribute("data-dock-slot")).toBe("center-right");
    expect(view.container.querySelectorAll('.dock-zone-center [data-pane-id="editor"]')).toHaveLength(1);
    expect(view.container.querySelectorAll(".dock-zone-center .dock-pane")).toHaveLength(1);

    click(view.container.querySelector('[aria-label="Move Preview pane"]')!);
    click(view.container.querySelector(".dock-drop-target.center-left")!);
    expect(view.container.querySelectorAll(".dock-zone-center .dock-pane")).toHaveLength(2);
    const centerSplit = view.container.querySelector('[aria-label="Resize center dock panes"]')!;
    keydown(centerSplit, "ArrowRight");
    expect(centerSplit.getAttribute("aria-valuenow")).toBe("52");

    click(view.container.querySelector('[aria-label="Move Preview pane"]')!);
    click(view.container.querySelector(".dock-drop-target.right-top")!);
    expect(view.container.querySelectorAll(".dock-zone-center .dock-pane")).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem("lattice-workspace-layout")!).placements.editor).toBe("center-right");

    roots.pop()?.unmount();
    const restored = renderApp();
    await flush();
    expect(restored.container.querySelector(".editor-pane")?.closest("[data-dock-slot]")?.getAttribute("data-dock-slot")).toBe("center-right");
  });

  it("tracks edits, autosaves them, and preserves the selected source in browser mode", async () => {
    vi.useFakeTimers();
    const view = renderApp();
    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;
    const changedSource = `${demoSource}\n% regression edit`;
    change(editor, changedSource);
    expect(buttonWithText(view.container, "Save").disabled).toBe(false);
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Autosave pending");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect((view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement).value).toBe(changedSource);
    expect(buttonWithText(view.container, "Save").disabled).toBe(true);
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Autosaved");
  });

  it("opens the table editor from the document toolbar and completes an insertion", async () => {
    const view = renderApp();
    await flush();
    click(view.container.querySelector('[aria-label="Insert table"]')!);
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).not.toBeNull();
    change(view.container.querySelector('[aria-label="Row 1, column 1"]') as HTMLInputElement, "Result");
    expect((view.container.querySelector(".table-insert") as HTMLButtonElement).disabled).toBe(false);
    click(view.container.querySelector(".table-insert")!);
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).toBeNull();
    await flush();
  });

  it("adds table packages to the root preamble when inserting from an included file", async () => {
    const project: ProjectSnapshot = {
      root: "/documents/multi-file-table",
      name: "multi-file-table",
      rootDocument: "main.tex",
      files: [
        { path: "main.tex", name: "main.tex", kind: "tex" },
        { path: "chapter.tex", name: "chapter.tex", kind: "tex" },
      ],
    };
    const rootSource = "\\documentclass{article}\n\\begin{document}\n\\input{chapter}\n\\end{document}";
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return args?.path === "main.tex" ? rootSource : "Chapter text";
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    click(view.container.querySelector('.file-row[title="chapter.tex"]')!);
    await flush();
    click(view.container.querySelector('[aria-label="Insert table"]')!);
    change(view.container.querySelector('[aria-label="Row 1, column 1"]') as HTMLInputElement, "Result");
    click(view.container.querySelector('[aria-label="Apply cell fill colour"]')!);
    click(view.container.querySelector(".table-insert")!);
    await flush();
    await flush();

    const rootWrite = invoke.mock.calls.find(([command, args]) => command === "write_project_file"
      && args?.path === "main.tex" && String(args?.content).includes("\\usepackage[table]{xcolor}"));
    expect(rootWrite?.[1]).toEqual({
      root: project.root,
      path: "main.tex",
      content: "\\documentclass{article}\n\\usepackage[table]{xcolor}\n\\begin{document}\n\\input{chapter}\n\\end{document}",
    });
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Added xcolor to main.tex");
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).toBeNull();
  });

  it("keeps the table dialog open when automatic root-preamble writing fails", async () => {
    const project: ProjectSnapshot = {
      root: "/documents/read-only-table",
      name: "read-only-table",
      rootDocument: "main.tex",
      files: [
        { path: "main.tex", name: "main.tex", kind: "tex" },
        { path: "chapter.tex", name: "chapter.tex", kind: "tex" },
      ],
    };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return args?.path === "main.tex" ? "\\documentclass{article}\n\\begin{document}" : "Chapter";
      if (command === "write_project_file" && args?.path === "main.tex") throw new Error("root document is read-only");
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    click(view.container.querySelector('.file-row[title="chapter.tex"]')!);
    await flush();
    click(view.container.querySelector('[aria-label="Insert table"]')!);
    change(view.container.querySelector('[aria-label="Row 1, column 1"]') as HTMLInputElement, "Result");
    click(view.container.querySelector('[aria-label="Apply cell fill colour"]')!);
    click(view.container.querySelector(".table-insert")!);
    await flush();
    await flush();

    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).not.toBeNull();
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("root document is read-only");
    expect((view.container.querySelector(".table-insert") as HTMLButtonElement).disabled).toBe(false);
  });

  it("runs manual builds from both the button and configured keyboard shortcut", async () => {
    vi.useFakeTimers();
    const view = renderApp();
    click(buttonWithText(view.container, "Build"));
    expect(view.container.textContent).toContain("Building…");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Built in 0.9s");

    keydown(window, "F1");
    expect(view.container.textContent).toContain("Building…");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Built in 0.9s");
  });

  it("autosaves an editor change and updates the preview in live mode", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("lattice-build-mode", "live");
    const view = renderApp();
    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;

    change(editor, `${demoSource}\n% live preview edit`);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_599); });
    expect(view.container.textContent).not.toContain("Building…");

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(view.container.textContent).toContain("Building…");

    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(view.container.querySelector(".statusbar")?.textContent).toContain("Built in 0.9s");
  });

  it("writes the latest editor content before a native live-preview compile", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("lattice-build-mode", "live");
    const project: ProjectSnapshot = {
      root: "/documents/live-paper",
      name: "live-paper",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return demoSource;
      if (command === "compile_project") {
        return { success: true, durationMs: 120, engine: "pdflatex", diagnostics: [], log: "ok", pdfBase64: "pdf" };
      }
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command} ${JSON.stringify(args)}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;
    const changedSource = `${demoSource}\n% native live preview edit`;
    change(editor, changedSource);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });

    expect(invoke).toHaveBeenCalledWith("write_project_file", {
      root: project.root,
      path: project.rootDocument,
      content: changedSource,
    });
    expect(invoke).toHaveBeenCalledWith("compile_project", {
      root: project.root,
      rootDocument: project.rootDocument,
      engine: "pdflatex",
      background: true,
    });
  });

  it("keeps live preview enabled after a slow but successful native build", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("lattice-build-mode", "live");
    const project: ProjectSnapshot = {
      root: "/documents/large-paper",
      name: "large-paper",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return demoSource;
      if (command === "compile_project") {
        return { success: true, durationMs: 12_000, engine: "pdflatex", diagnostics: [], log: "ok", pdfBase64: "pdf" };
      }
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;

    change(editor, `${demoSource}\n% first slow build`);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    await flush();
    expect(window.localStorage.getItem("lattice-build-mode")).toBe("live");

    change(editor, `${demoSource}\n% second slow build`);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(invoke.mock.calls.filter(([command]) => command === "compile_project")).toHaveLength(2);
  });

  it("still falls back to on-demand mode after a native live-build process failure", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("lattice-build-mode", "live");
    const project: ProjectSnapshot = {
      root: "/documents/failing-paper",
      name: "failing-paper",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return demoSource;
      if (command === "compile_project") throw new Error("live build exceeded the hard timeout");
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;
    change(editor, `${demoSource}\n% trigger failed live build`);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    await flush();

    expect(window.localStorage.getItem("lattice-build-mode")).toBe("on-demand");
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Live preview paused after a build failure");
  });

  it("opens files, applies bibliography restrictions, keeps the brand inert, and reports unsupported browser actions", async () => {
    const view = renderApp();
    click(view.container.querySelector('[title="references.bib"]')!);
    await flush();
    expect((view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLElement).dataset.language).toBe("bibtex");
    expect((view.container.querySelector('[aria-label="Bold"]') as HTMLButtonElement).disabled).toBe(true);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".custom-command-button")].every((button) => button.disabled)).toBe(true);

    const brand = view.container.querySelector(".brand")!;
    expect(brand.tagName).toBe("DIV");
    expect(brand.getAttribute("role")).toBeNull();
    click(brand);
    await flush();
    expect(view.container.querySelector(".notice")).toBeNull();

    keydown(window, "o", { ctrlKey: true });
    await flush();
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Opening local folders is available in the desktop app");
    click(view.container.querySelector('[aria-label="Dismiss notification"]')!);
    expect(view.container.querySelector(".notice")).toBeNull();
  });

  it("opens, switches, deduplicates, and closes file tabs", async () => {
    const view = renderApp();
    await flush();
    const fileTabs = () => [...view.container.querySelectorAll<HTMLButtonElement>('.file-tabs [role="tab"]')];
    expect(fileTabs().map((tab) => tab.textContent)).toEqual(["main.tex"]);

    click(view.container.querySelector('.file-row[title="references.bib"]')!);
    await flush();
    expect(fileTabs().map((tab) => tab.textContent)).toEqual(["main.tex", "references.bib"]);
    expect(fileTabs()[1].getAttribute("aria-selected")).toBe("true");

    click(fileTabs()[0]);
    await flush();
    expect(fileTabs()[0].getAttribute("aria-selected")).toBe("true");
    click(view.container.querySelector('.file-row[title="references.bib"]')!);
    await flush();
    expect(fileTabs()).toHaveLength(2);

    click(view.container.querySelector('.file-tabs [aria-label="Close references.bib"]')!);
    await flush();
    expect(fileTabs().map((tab) => tab.textContent)).toEqual(["main.tex"]);
    expect((view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLElement).dataset.language).toBe("latex");
  });

  it("opens, switches, deduplicates, autosaves, and closes project tabs", async () => {
    const first: ProjectSnapshot = {
      root: "/documents/first",
      name: "First",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    const second: ProjectSnapshot = {
      root: "/documents/second",
      name: "Second",
      rootDocument: "paper.tex",
      files: [{ path: "paper.tex", name: "paper.tex", kind: "tex" }],
    };
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return first;
      if (command === "choose_project") return second;
      if (command === "read_project_file") return args?.root === second.root ? "Second source" : "First source";
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };
    const view = renderApp();
    await flush();
    await flush();
    const projectTabs = () => [...view.container.querySelectorAll<HTMLButtonElement>('.project-tabs [role="tab"]')];
    expect(projectTabs().map((tab) => tab.textContent)).toEqual(["First"]);

    click(view.container.querySelector('.project-tabs [aria-label="Open project"]')!);
    await flush();
    await flush();
    expect(projectTabs().map((tab) => tab.textContent)).toEqual(["First", "Second"]);
    expect(projectTabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(loadWorkspaceSession()).toMatchObject({
      activeRoot: second.root,
      projects: [
        { root: first.root, openPaths: [first.rootDocument], activePath: first.rootDocument },
        { root: second.root, openPaths: [second.rootDocument], activePath: second.rootDocument },
      ],
    });

    const editor = view.container.querySelector('[aria-label="Mock Monaco editor"]') as HTMLTextAreaElement;
    change(editor, "Edited second source");
    click(projectTabs()[0]);
    await flush();
    await flush();
    expect(invoke).toHaveBeenCalledWith("write_project_file", {
      root: second.root,
      path: second.rootDocument,
      content: "Edited second source",
    });
    expect(projectTabs()[0].getAttribute("aria-selected")).toBe("true");

    click(view.container.querySelector('.project-tabs [aria-label="Open project"]')!);
    await flush();
    await flush();
    expect(projectTabs()).toHaveLength(2);
    expect(projectTabs()[1].getAttribute("aria-selected")).toBe("true");

    click(view.container.querySelector('.project-tabs [aria-label^="Close Second"]')!);
    await flush();
    await flush();
    expect(projectTabs().map((tab) => tab.textContent)).toEqual(["First"]);
    expect(view.container.querySelector(".document-title")?.textContent).toContain("First");
  });

  it("restores every valid project and file tab from the previous desktop session", async () => {
    const first: ProjectSnapshot = {
      root: "/documents/first",
      name: "First",
      rootDocument: "main.tex",
      files: [
        { path: "main.tex", name: "main.tex", kind: "tex" },
        { path: "chapter.tex", name: "chapter.tex", kind: "tex" },
      ],
    };
    const second: ProjectSnapshot = {
      root: "/documents/second",
      name: "Second",
      rootDocument: "paper.tex",
      files: [
        { path: "paper.tex", name: "paper.tex", kind: "tex" },
        { path: "references.bib", name: "references.bib", kind: "bib" },
      ],
    };
    window.localStorage.setItem("lattice-workspace-session", JSON.stringify({
      version: 1,
      activeRoot: second.root,
      projects: [
        { root: first.root, openPaths: ["main.tex", "chapter.tex"], activePath: "chapter.tex" },
        { root: second.root, openPaths: ["paper.tex", "references.bib"], activePath: "references.bib" },
      ],
    }));
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_project") return args?.root === first.root ? first : second;
      if (command === "read_project_file") return `${String(args?.root)}:${String(args?.path)}`;
      if (command === "set_recent_projects") return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    const projectTabs = () => [...view.container.querySelectorAll<HTMLButtonElement>('.project-tabs [role="tab"]')];
    const fileTabs = () => [...view.container.querySelectorAll<HTMLButtonElement>('.file-tabs [role="tab"]')];
    expect(projectTabs().map((tab) => tab.textContent)).toEqual(["First", "Second"]);
    expect(projectTabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(fileTabs().map((tab) => tab.textContent)).toEqual(["paper.tex", "references.bib"]);
    expect(fileTabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(invoke.mock.calls.some(([command]) => command === "read_starter_project")).toBe(false);

    click(projectTabs()[0]);
    await flush();
    await flush();
    expect(fileTabs().map((tab) => tab.textContent)).toEqual(["main.tex", "chapter.tex"]);
    expect(fileTabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(loadWorkspaceSession()?.activeRoot).toBe(first.root);
  });

  it("skips missing projects and stale files while restoring the remaining session", async () => {
    const available: ProjectSnapshot = {
      root: "/documents/available",
      name: "Available",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    window.localStorage.setItem("lattice-workspace-session", JSON.stringify({
      version: 1,
      activeRoot: "/documents/missing",
      projects: [
        { root: "/documents/missing", openPaths: ["gone.tex"], activePath: "gone.tex" },
        { root: available.root, openPaths: ["deleted.tex"], activePath: "deleted.tex" },
      ],
    }));
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_project" && args?.root === "/documents/missing") throw new Error("missing");
      if (command === "read_project") return available;
      if (command === "read_project_file") return "Available source";
      if (command === "set_recent_projects") return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    expect([...view.container.querySelectorAll('.project-tabs [role="tab"]')].map((tab) => tab.textContent)).toEqual(["Available"]);
    expect([...view.container.querySelectorAll('.file-tabs [role="tab"]')].map((tab) => tab.textContent)).toEqual(["main.tex"]);
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("previous session could not be reopened");
  });

  it("falls back to the starter project when no saved project can be restored", async () => {
    const starter: ProjectSnapshot = {
      root: "/app-data/reliable-documents",
      name: "reliable-documents",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" }],
    };
    window.localStorage.setItem("lattice-workspace-session", JSON.stringify({
      version: 1,
      activeRoot: "/documents/missing",
      projects: [{ root: "/documents/missing", openPaths: ["main.tex"], activePath: "main.tex" }],
    }));
    const invoke = vi.fn(async (command: string) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_project") throw new Error("missing");
      if (command === "read_starter_project") return starter;
      if (command === "read_project_file") return "Starter source";
      if (command === "set_recent_projects") return null;
      throw new Error(`Unexpected native command: ${command}`);
    });
    window.lattice = {
      invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      onMenuAction: () => () => undefined,
    };

    const view = renderApp();
    await flush();
    await flush();
    expect(view.container.querySelector(".document-title")?.textContent).toContain("reliable-documents");
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("starter project instead");
  });

  it("opens settings from the toolbar and keyboard and runs the review-first AI flow", async () => {
    vi.useFakeTimers();
    const view = renderApp();
    await flush();
    click(view.container.querySelector('[aria-label="Open editor settings"]')!);
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    click(view.container.querySelector('[aria-label="Close settings"]')!);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    keydown(window, ",", { ctrlKey: true });
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    click(view.container.querySelector('[aria-label="Close settings"]')!);

    click(buttonWithText(view.container, "Make this more cautious"));
    expect(view.container.textContent).toContain("Reading the document");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(view.container.textContent).toContain("Temper the strength of the claim");
    click(buttonWithText(view.container, "Accept edit"));
    expect(view.container.textContent).not.toContain("Temper the strength of the claim");
    expect(view.container.querySelector(".dirty-dot")).not.toBeNull();
  });
});
