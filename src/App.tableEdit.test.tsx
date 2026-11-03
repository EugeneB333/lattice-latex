/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { change, cleanupRoots, click, flush, render } from "./test/render";

interface Position { lineNumber: number; column: number }
interface RangeLike { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

const monacoHarness = vi.hoisted(() => ({
  value: "",
  mouseDown: undefined as ((event: unknown) => void) | undefined,
  selection: undefined as RangeLike | undefined,
  editor: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./spellcheck", () => ({
  createSpellcheckController: () => ({ update: vi.fn(), dispose: vi.fn() }),
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  class Range implements RangeLike {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
    getStartPosition() { return { lineNumber: this.startLineNumber, column: this.startColumn }; }
  }
  class Selection extends Range {
    get positionLineNumber() { return this.endLineNumber; }
    isEmpty() { return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn; }
  }
  const offsetAt = (position: Position) => {
    const lines = monacoHarness.value.split("\n");
    return lines.slice(0, position.lineNumber - 1).reduce((total, line) => total + line.length + 1, 0) + position.column - 1;
  };
  const positionAt = (offset: number) => {
    const before = monacoHarness.value.slice(0, Math.max(0, offset));
    const lines = before.split("\n");
    return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 };
  };
  const model = {
    getValue: () => monacoHarness.value,
    setValue: (value: string) => { monacoHarness.value = value; },
    getOffsetAt: offsetAt,
    getPositionAt: positionAt,
    validatePosition: (position: Position) => position,
    getValueInRange: (range: RangeLike) => monacoHarness.value.slice(offsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }), offsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })),
    getFullModelRange: () => new Range(1, 1, positionAt(monacoHarness.value.length).lineNumber, positionAt(monacoHarness.value.length).column),
    getLineMaxColumn: (line: number) => (monacoHarness.value.split("\n")[line - 1]?.length ?? 0) + 1,
  };
  const editor = {
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    setPosition: vi.fn(),
    getSelection: () => monacoHarness.selection ?? new Selection(1, 1, 1, 1),
    setSelection: (selection: RangeLike) => { monacoHarness.selection = selection; },
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
    onMouseDown: vi.fn((callback: (event: unknown) => void) => { monacoHarness.mouseDown = callback; return { dispose: vi.fn() }; }),
    onDidDispose: vi.fn(),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn((_source: string, edits: Array<{ range: RangeLike; text: string }>) => {
      const replacements = edits.map((edit) => ({
        start: offsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn }),
        end: offsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn }),
        text: edit.text,
      })).sort((left, right) => right.start - left.start);
      for (const replacement of replacements) monacoHarness.value = `${monacoHarness.value.slice(0, replacement.start)}${replacement.text}${monacoHarness.value.slice(replacement.end)}`;
    }),
    focus: vi.fn(),
    trigger: vi.fn(),
    getContribution: vi.fn(),
    hasTextFocus: () => true,
    revealRangeInCenterIfOutsideViewport: vi.fn(),
    revealLineInCenter: vi.fn(),
    revealPositionInCenter: vi.fn(),
  };
  monacoHarness.editor = editor;
  return {
    default: (props: { defaultValue?: string; onMount?: (editor: unknown, monaco: unknown) => void }) => {
      React.useEffect(() => {
        monacoHarness.value = props.defaultValue ?? "";
        props.onMount?.(editor, { Range, Selection });
      }, []);
      return React.createElement("textarea", { "aria-label": "Mock Monaco editor", defaultValue: props.defaultValue });
    },
  };
});

vi.mock("./PdfPreview", async () => {
  const React = await import("react");
  return {
    PdfPreview: ({ onEditTable }: { onEditTable: (page: number, x: number, y: number) => void }) => React.createElement(
      "button",
      { "aria-label": "Mock Shift-click PDF table", onClick: () => onEditTable(1, 72, 240) },
      "PDF",
    ),
  };
});

import App from "./App";
import { demoSource } from "./demo";

const roots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  window.localStorage.clear();
  delete window.lattice;
  monacoHarness.value = "";
  monacoHarness.mouseDown = undefined;
  monacoHarness.selection = undefined;
});

afterEach(() => {
  cleanupRoots(roots);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function editorMouse(position: Position, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  act(() => monacoHarness.mouseDown?.({
    event: { ...modifiers, preventDefault, stopPropagation },
    target: { position },
  }));
  return { preventDefault, stopPropagation };
}

describe("source table graphical editing", () => {
  it("preserves ordinary Shift-click and opens a table with Ctrl+Shift-click", async () => {
    const view = render(<App />);
    roots.push(view);
    await flush();
    await flush();
    const offset = monacoHarness.value.indexOf("Baseline &");
    const lines = monacoHarness.value.slice(0, offset).split("\n");
    const position = { lineNumber: lines.length, column: lines.at(-1)!.length + 1 };

    const shiftOnly = editorMouse(position, { shiftKey: true });
    expect(shiftOnly.preventDefault).not.toHaveBeenCalled();
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).toBeNull();

    const editGesture = editorMouse(position, { ctrlKey: true, shiftKey: true });
    expect(editGesture.preventDefault).toHaveBeenCalledOnce();
    expect(editGesture.stopPropagation).toHaveBeenCalledOnce();
    expect(view.container.querySelector("#table-editor-title")?.textContent).toBe("Edit table");
    expect((view.container.querySelector('[aria-label="Row 2, column 1"]') as HTMLInputElement).value).toBe("Baseline");
    expect((view.container.querySelector('[aria-label="Table caption"]') as HTMLInputElement).value).toBe("Results from the evaluation.");

    change(view.container.querySelector('[aria-label="Row 2, column 2"]') as HTMLInputElement, "84.2");
    click(view.container.querySelector(".table-insert")!);
    await flush();
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).toBeNull();
    expect(monacoHarness.value).toContain("Baseline & 84.2 & 4.8");
    expect(monacoHarness.value.match(/\\begin\{table\}/g)).toHaveLength(1);
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Table updated");
  });

  it("reports unsupported source tables without changing the source", async () => {
    const view = render(<App />);
    roots.push(view);
    await flush();
    await flush();
    monacoHarness.value = "\\documentclass{article}\n\\begin{document}\n\\begin{tabular}{p{3cm}}\nText \\\\n\\end{tabular}\n\\end{document}";
    const offset = monacoHarness.value.indexOf("Text");
    const lines = monacoHarness.value.slice(0, offset).split("\n");
    editorMouse({ lineNumber: lines.length, column: lines.at(-1)!.length + 1 }, { ctrlKey: true, shiftKey: true });
    expect(view.container.querySelector('[aria-labelledby="table-editor-title"]')).toBeNull();
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("cannot safely preserve");
  });

  it("updates the exact table range and adds newly required packages in the same edit", async () => {
    const view = render(<App />);
    roots.push(view);
    await flush();
    await flush();
    monacoHarness.value = "\\documentclass{article}\n\\begin{document}\nBefore\n\\begin{tabular}{l}\n  \\cellcolor[HTML]{FFF2CC}Old \\\\n\\end{tabular}\nAfter\n\\end{document}";
    const offset = monacoHarness.value.indexOf("Old");
    const lines = monacoHarness.value.slice(0, offset).split("\n");
    editorMouse({ lineNumber: lines.length, column: lines.at(-1)!.length + 1 }, { ctrlKey: true, shiftKey: true });
    change(view.container.querySelector('[aria-label="Row 1, column 1"]') as HTMLInputElement, "New");
    click(view.container.querySelector(".table-insert")!);
    await flush();

    expect(monacoHarness.value).toContain("\\documentclass{article}\n\\usepackage[table]{xcolor}\n\\begin{document}");
    expect(monacoHarness.value).toContain("Before\n\\begin{tabular}{l}");
    expect(monacoHarness.value).toContain("\\cellcolor[HTML]{FFF2CC}New");
    expect(monacoHarness.value).toContain("\\end{tabular}\nAfter");
    expect(monacoHarness.value).not.toContain("Old");
  });

  it("uses inverse SyncTeX to open the source table from a PDF Shift-click", async () => {
    const tableLine = demoSource.slice(0, demoSource.indexOf("Baseline &")).split("\n").length;
    const project = {
      root: "/documents/pdf-table",
      name: "pdf-table",
      rootDocument: "main.tex",
      files: [{ path: "main.tex", name: "main.tex", kind: "tex" as const }],
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === "detect_engines") return [{ id: "pdflatex", label: "pdfLaTeX", available: true }];
      if (command === "read_starter_project") return project;
      if (command === "read_project_file") return demoSource;
      if (command === "compile_project") return { success: true, durationMs: 20, engine: "pdflatex", diagnostics: [], log: "ok", pdfBase64: "pdf" };
      if (command === "inverse_search") return { path: "main.tex", line: tableLine, column: 1 };
      if (["set_recent_projects", "write_project_file"].includes(command)) return null;
      throw new Error(`Unexpected command ${command}`);
    });
    window.lattice = { invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>, onMenuAction: () => () => undefined };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    const view = render(<App />);
    roots.push(view);
    await flush();
    await flush();
    click([...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Build"))!);
    await flush();
    await flush();
    click(view.container.querySelector('[aria-label="Mock Shift-click PDF table"]')!);
    await flush();
    await flush();

    expect(invoke).toHaveBeenCalledWith("inverse_search", { root: project.root, rootDocument: "main.tex", page: 1, x: 72, y: 240 });
    expect(view.container.querySelector("#table-editor-title")?.textContent).toBe("Edit table");
    expect((view.container.querySelector('[aria-label="Row 2, column 1"]') as HTMLInputElement).value).toBe("Baseline");
  });
});
