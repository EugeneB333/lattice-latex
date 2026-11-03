// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiPanel,
  CustomToolbar,
  Diagnostics,
  EditorToolbar,
  FileRail,
  KeybindingRecorder,
  MathToolbar,
  PdfStage,
  SettingsPanel,
} from "./App";
import { defaultUserCommands } from "./customCommands";
import { DEFAULT_KEYBINDINGS } from "./lib/keybindings";
import type { BuildResult, ProjectSnapshot } from "./types";
import { change, cleanupRoots, click, keydown, render } from "./test/render";

vi.mock("./PdfPreview", () => ({
  PdfPreview: ({ pdfBase64, loadPageImage }: { pdfBase64: string; loadPageImage?: (page: number) => Promise<string> }) => (
    <button data-testid="pdf-preview" onClick={() => { void loadPageImage?.(2); }}>{pdfBase64}</button>
  ),
}));

const roots: Array<{ unmount: () => void }> = [];

afterEach(() => {
  cleanupRoots(roots);
  document.body.innerHTML = "";
  window.localStorage.clear();
  delete window.lattice;
  vi.restoreAllMocks();
});

function buttonByLabel(container: ParentNode, label: string) {
  return container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

const project: ProjectSnapshot = {
  root: "/paper",
  name: "Paper",
  rootDocument: "main.tex",
  files: [
    { path: "main.tex", name: "main.tex", kind: "tex" },
    { path: "chapters/results.tex", name: "results.tex", kind: "tex" },
    { path: "references.bib", name: "references.bib", kind: "bib" },
    { path: "figures/chart.png", name: "chart.png", kind: "image" },
  ],
};

describe("editor toolbars", () => {
  it("routes every document toolbar action and resets the paragraph selector", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onFormat = vi.fn();
    const onInsertTable = vi.fn();
    const view = render(<EditorToolbar disabled={false} onUndo={onUndo} onRedo={onRedo} onFormat={onFormat} onInsertTable={onInsertTable} />);
    roots.push(view);
    click(buttonByLabel(view.container, "Undo"));
    click(buttonByLabel(view.container, "Redo"));
    for (const label of ["Bold", "Italic", "Underline", "Monospace", "Bulleted list", "Numbered list", "Block quote", "Align left", "Centre", "Align right", "Insert link", "Inline mathematics"]) {
      click(buttonByLabel(view.container, label));
    }
    const select = view.container.querySelector('[aria-label="Paragraph style"]') as HTMLSelectElement;
    change(select, "subsection");
    click(buttonByLabel(view.container, "Insert table"));

    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(onInsertTable).toHaveBeenCalledOnce();
    expect(onFormat.mock.calls.flat()).toEqual([
      "bold", "italic", "underline", "monospace", "bullet-list", "numbered-list", "quote",
      "left", "center", "right", "link", "inline-math", "subsection",
    ]);
    expect(select.value).toBe("");
  });

  it("disables every formatting control for bibliography files", () => {
    const view = render(<EditorToolbar disabled onUndo={vi.fn()} onRedo={vi.fn()} onFormat={vi.fn()} onInsertTable={vi.fn()} />);
    roots.push(view);
    expect([...view.container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !["Undo", "Redo"].includes(button.getAttribute("aria-label") ?? "")).every((button) => button.disabled)).toBe(true);
    expect((view.container.querySelector('[aria-label="Paragraph style"]') as HTMLSelectElement).disabled).toBe(true);
  });

  it("routes math buttons and grouped menu selections", () => {
    const onInsert = vi.fn();
    const view = render(<MathToolbar disabled={false} position="left" onInsert={onInsert} />);
    roots.push(view);
    expect(view.container.querySelector('[role="toolbar"]')?.classList.contains("left")).toBe(true);
    click(buttonByLabel(view.container, "Fraction"));
    click(buttonByLabel(view.container, "Definite integral"));
    const greek = view.container.querySelector('[aria-label="Greek letters"]') as HTMLSelectElement;
    change(greek, "alpha");
    expect(onInsert.mock.calls.flat()).toEqual(["fraction", "integral", "alpha"]);
    expect(greek.value).toBe("");
  });

  it("renders twelve custom shortcuts and disables empty or globally disabled entries", () => {
    const commands = defaultUserCommands();
    commands[0] = { label: "Theorem", template: "\\begin{theorem}" };
    commands[1] = { label: "", template: "text" };
    const onInsert = vi.fn();
    const view = render(<CustomToolbar commands={commands} disabled={false} position="bottom" onInsert={onInsert} />);
    roots.push(view);
    const buttons = view.container.querySelectorAll<HTMLButtonElement>(".custom-command-button");
    expect(buttons).toHaveLength(12);
    expect(buttons[0].title).toContain("Shift+F1");
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].getAttribute("aria-label")).toBe("C2");
    expect(buttons[2].disabled).toBe(true);
    click(buttons[0]);
    click(buttons[1]);
    expect(onInsert.mock.calls.flat()).toEqual(["\\begin{theorem}", "text"]);

    view.rerender(<CustomToolbar commands={commands} disabled position="bottom" onInsert={onInsert} />);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".custom-command-button")].every((button) => button.disabled)).toBe(true);
  });
});

describe("KeybindingRecorder", () => {
  it("records normalized shortcuts and exits recording", () => {
    const onChange = vi.fn();
    const view = render(<KeybindingRecorder value="Ctrl+D" label="Delete line" onChange={onChange} />);
    roots.push(view);
    const button = view.container.querySelector("button")!;
    click(button);
    expect(button.textContent).toContain("Press shortcut");
    keydown(button, "k", { ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith("Ctrl+Shift+K");
    expect(button.textContent).toContain("Ctrl");
  });

  it("ignores modifier-only input and cancels with Escape or blur", () => {
    const onChange = vi.fn();
    const view = render(<KeybindingRecorder value="F1" label="Build" onChange={onChange} />);
    roots.push(view);
    const button = view.container.querySelector("button")!;
    click(button);
    keydown(button, "Control", { ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    keydown(button, "Escape");
    expect(button.textContent).toBe("F1");
    click(button);
    act(() => { button.focus(); button.blur(); });
    expect(button.textContent).toBe("F1");
  });
});

describe("FileRail", () => {
  it("renders file kinds, nested indentation, filtering, opening, and clearing", () => {
    const onOpen = vi.fn();
    const onOpenProject = vi.fn();
    const view = render(<FileRail project={project} activePath="main.tex" outline={[]} onOpen={onOpen} onOpenProject={onOpenProject} onSelectOutline={vi.fn()} />);
    roots.push(view);
    expect(view.container.querySelectorAll(".file-row")).toHaveLength(4);
    expect((view.container.querySelector('[title="chapters/results.tex"]') as HTMLElement).style.paddingLeft).toBe("29px");
    click(buttonByLabel(view.container, "Open project"));
    expect(onOpenProject).toHaveBeenCalledOnce();
    click(view.container.querySelector('[title="references.bib"]')!);
    expect(onOpen).toHaveBeenCalledWith(project.files[2]);

    const search = view.container.querySelector('[aria-label="Search project files"]') as HTMLInputElement;
    change(search, "RESULT");
    expect(view.container.querySelectorAll(".file-row")).toHaveLength(1);
    click(buttonByLabel(view.container, "Clear project search"));
    expect(view.container.querySelectorAll(".file-row")).toHaveLength(4);
  });

  it("collapses files and displays the empty-search result", () => {
    const view = render(<FileRail project={project} activePath="main.tex" outline={[]} onOpen={vi.fn()} onOpenProject={vi.fn()} onSelectOutline={vi.fn()} />);
    roots.push(view);
    const projectButton = view.container.querySelector(".project-name") as HTMLButtonElement;
    click(projectButton);
    expect(projectButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector(".file-list")?.classList.contains("collapsed")).toBe(true);
    const search = view.container.querySelector('[aria-label="Search project files"]') as HTMLInputElement;
    change(search, "missing");
    expect(view.container.querySelector(".no-files")).toBeNull();
    click(projectButton);
    expect(view.container.textContent).toContain("No matching files");
  });

  it("switches to a persistent syllabus and selects the active outline entry", () => {
    const onSelect = vi.fn();
    const outline = [
      { command: "section" as const, title: "Intro", line: 1, depth: 0 },
      { command: "subsection" as const, title: "Method", line: 5, depth: 1 },
    ];
    const view = render(<FileRail project={project} activePath="main.tex" outline={outline} activeOutlineLine={5} onOpen={vi.fn()} onOpenProject={vi.fn()} onSelectOutline={onSelect} />);
    roots.push(view);
    const syllabusTab = [...view.container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.includes("Syllabus"))!;
    click(syllabusTab);
    expect(window.localStorage.getItem("lattice-sidebar-view")).toBe("syllabus");
    expect(view.container.querySelector(".syllabus-list .active")?.textContent).toContain("Method");
    click([...view.container.querySelectorAll(".syllabus-list button")].find((button) => button.textContent?.includes("Intro"))!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("shows a syllabus empty state and focuses file search with Ctrl/Cmd+K", () => {
    const view = render(<FileRail project={project} activePath="main.tex" outline={[]} onOpen={vi.fn()} onOpenProject={vi.fn()} onSelectOutline={vi.fn()} />);
    roots.push(view);
    const search = view.container.querySelector('[aria-label="Search project files"]') as HTMLInputElement;
    keydown(window, "k", { ctrlKey: true });
    expect(document.activeElement).toBe(search);
    click([...view.container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.includes("Syllabus"))!);
    expect(view.container.textContent).toContain("No sections yet");
  });
});

describe("Diagnostics", () => {
  it("renders nothing without diagnostics and limits the visible list to six", () => {
    const empty = render(<Diagnostics onSelect={vi.fn()} />);
    roots.push(empty);
    expect(empty.container.innerHTML).toBe("");
    const diagnostics = Array.from({ length: 8 }, (_, index) => ({ severity: index % 2 ? "warning" as const : "error" as const, line: index ? index : undefined, message: `Issue ${index}` }));
    empty.rerender(<Diagnostics result={{ success: false, durationMs: 1, engine: "lualatex", diagnostics, log: "" }} onSelect={vi.fn()} />);
    expect(empty.container.querySelectorAll(".diagnostics button")).toHaveLength(6);
    expect(empty.container.textContent).not.toContain("Issue 7");
    expect(empty.container.querySelectorAll(".diagnostic-line")).toHaveLength(5);
  });

  it("returns the selected diagnostic", () => {
    const diagnostic = { severity: "error" as const, line: 9, message: "Undefined command" };
    const onSelect = vi.fn();
    const view = render(<Diagnostics result={{ success: false, durationMs: 1, engine: "pdflatex", diagnostics: [diagnostic], log: "" }} onSelect={onSelect} />);
    roots.push(view);
    click(view.container.querySelector(".diagnostics button")!);
    expect(onSelect).toHaveBeenCalledWith(diagnostic);
  });
});

describe("PdfStage", () => {
  const successful: BuildResult = {
    success: true,
    durationMs: 10,
    engine: "lualatex",
    diagnostics: [],
    log: "",
    pdfBase64: "pdf",
  };

  it("enables output actions only when a PDF exists", () => {
    const onPrint = vi.fn();
    const onOpen = vi.fn();
    const view = render(<PdfStage building={false} onNavigate={vi.fn()} onEditTable={vi.fn()} onPrint={onPrint} onOpenExternal={onOpen} />);
    roots.push(view);
    expect(buttonByLabel(view.container, "Print rendered PDF").disabled).toBe(true);
    expect(buttonByLabel(view.container, "Open rendered PDF externally").disabled).toBe(true);
    view.rerender(<PdfStage result={successful} building={false} onNavigate={vi.fn()} onEditTable={vi.fn()} onPrint={onPrint} onOpenExternal={onOpen} />);
    click(buttonByLabel(view.container, "Print rendered PDF"));
    click(buttonByLabel(view.container, "Open rendered PDF externally"));
    expect(onPrint).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(view.container.textContent).toContain("Ctrl/Cmd+click ↔ source");
    expect(view.container.textContent).toContain("Shift+click edit table");
  });

  it("shows build progress while retaining the PDF preview", () => {
    const view = render(<PdfStage result={successful} building onNavigate={vi.fn()} onEditTable={vi.fn()} onPrint={vi.fn()} onOpenExternal={vi.fn()} />);
    roots.push(view);
    expect(view.container.textContent).toContain("Typesetting…");
    expect(view.container.querySelector('[data-testid="pdf-preview"]')?.textContent).toBe("pdf");
  });

  it("loads desktop preview pages through the build's native rendering version", async () => {
    const invoke = vi.fn().mockResolvedValue({ svgBase64: "svg" });
    window.lattice = { invoke };
    const view = render(
      <PdfStage
        result={{ ...successful, pdfVersion: "version-4" }}
        building={false}
        root="/paper"
        rootDocument="main.tex"
        onNavigate={vi.fn()}
        onEditTable={vi.fn()}
        onPrint={vi.fn()}
        onOpenExternal={vi.fn()}
      />,
    );
    roots.push(view);
    click(view.container.querySelector('[data-testid="pdf-preview"]')!);
    await act(async () => undefined);
    expect(invoke).toHaveBeenCalledWith("render_pdf_page", {
      root: "/paper",
      rootDocument: "main.tex",
      pdfVersion: "version-4",
      page: 2,
    });
  });

  it("clamps zoom to 60–180 percent", () => {
    const view = render(<PdfStage result={successful} building={false} onNavigate={vi.fn()} onEditTable={vi.fn()} onPrint={vi.fn()} onOpenExternal={vi.fn()} />);
    roots.push(view);
    const out = buttonByLabel(view.container, "Zoom out");
    const zoomIn = buttonByLabel(view.container, "Zoom in");
    for (let index = 0; index < 6; index += 1) click(out);
    expect(view.container.textContent).toContain("60%");
    expect(out.disabled).toBe(true);
    for (let index = 0; index < 13; index += 1) click(zoomIn);
    expect(view.container.textContent).toContain("180%");
    expect(zoomIn.disabled).toBe(true);
  });
});

describe("AiPanel", () => {
  it("offers every quick prompt and submits a trimmed custom prompt", () => {
    const onAsk = vi.fn();
    const view = render(<AiPanel sourceBefore="" loading={false} onAsk={onAsk} onAccept={vi.fn()} onReject={vi.fn()} />);
    roots.push(view);
    const quick = view.container.querySelector(".quick-list button")!;
    click(quick);
    expect(onAsk).toHaveBeenCalledWith("Make this more cautious and academically precise");
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement;
    change(textarea, "  repair this  ");
    click(view.container.querySelector(".prompt-box button")!);
    expect(onAsk).toHaveBeenLastCalledWith("repair this");
    expect(textarea.value).toBe("");
  });

  it("submits Enter, preserves Shift+Enter, and blocks empty/loading prompts", () => {
    const onAsk = vi.fn();
    const view = render(<AiPanel sourceBefore="" loading={false} onAsk={onAsk} onAccept={vi.fn()} onReject={vi.fn()} />);
    roots.push(view);
    const textarea = view.container.querySelector("textarea") as HTMLTextAreaElement;
    change(textarea, "question");
    keydown(textarea, "Enter", { shiftKey: true });
    expect(onAsk).not.toHaveBeenCalled();
    keydown(textarea, "Enter");
    expect(onAsk).toHaveBeenCalledWith("question");
    view.rerender(<AiPanel sourceBefore="" loading onAsk={onAsk} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect((view.container.querySelector(".prompt-box button") as HTMLButtonElement).disabled).toBe(true);
    expect(view.container.textContent).toContain("Reading the document…");
  });

  it("shows a focused diff and routes accept and dismiss actions", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const before = Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n");
    const after = before.replace("line 5", "changed 5");
    const view = render(<AiPanel proposal={{ summary: "Fix", explanation: "Changed one line", replacement: after, mode: "live" }} sourceBefore={before} loading={false} onAsk={vi.fn()} onAccept={onAccept} onReject={onReject} />);
    roots.push(view);
    expect(view.container.textContent).toContain("Fix");
    expect(view.container.textContent).toContain("−line 5");
    expect(view.container.textContent).toContain("+changed 5");
    expect(view.container.textContent).not.toContain("line 0");
    click([...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Accept edit"))!);
    click([...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Dismiss"))!);
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });
});

describe("SettingsPanel", () => {
  function props() {
    return {
      theme: "lattice" as const,
      font: "jetbrains" as const,
      fontSize: 13.5,
      mathToolbarEnabled: true,
      mathToolbarPosition: "top" as const,
      customToolbarEnabled: true,
      customToolbarPosition: "top" as const,
      customCommands: defaultUserCommands(),
      buildMode: "on-demand" as const,
      spellcheckEnabled: true,
      spellcheckDialect: "british" as const,
      keybindings: DEFAULT_KEYBINDINGS,
      onThemeChange: vi.fn(), onFontChange: vi.fn(), onFontSizeChange: vi.fn(),
      onMathToolbarEnabledChange: vi.fn(), onMathToolbarPositionChange: vi.fn(),
      onCustomToolbarEnabledChange: vi.fn(), onCustomToolbarPositionChange: vi.fn(),
      onCustomCommandChange: vi.fn(), onBuildModeChange: vi.fn(),
      onSpellcheckEnabledChange: vi.fn(), onSpellcheckDialectChange: vi.fn(),
      onKeybindingChange: vi.fn(), onReset: vi.fn(), onClose: vi.fn(),
    };
  }

  it("groups settings into accessible tabs with mouse and keyboard navigation", () => {
    const view = render(<SettingsPanel {...props()} />);
    roots.push(view);
    const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...view.container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Appearance", "Editor", "Custom Commands", "Writing", "Shortcuts"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true, true, true]);

    click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false, true, true, true]);

    tabs[1].focus();
    keydown(tabs[1], "ArrowRight");
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    keydown(tabs[2], "End");
    expect(tabs[4].getAttribute("aria-selected")).toBe("true");
    keydown(tabs[4], "ArrowRight");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("renders all settings and routes select, range, toggle, and preview changes", () => {
    const input = props();
    const view = render(<SettingsPanel {...input} />);
    roots.push(view);
    expect(view.container.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(view.container.querySelectorAll('[aria-label^="Custom command"][aria-label$="label"]')).toHaveLength(12);
    expect(view.container.querySelectorAll('[aria-label^="Custom command"][aria-label$="template"]')).toHaveLength(12);

    change(view.container.querySelector('[aria-label="Colour theme"]') as HTMLSelectElement, "paper");
    click(buttonByLabel(view.container, "Use Evergreen"));
    change(view.container.querySelector('[aria-label="Editor font"]') as HTMLSelectElement, "fira");
    change(view.container.querySelector('[aria-label="Editor font size"]') as HTMLInputElement, "18");
    click(view.container.querySelector('[aria-label="Show maths toolbar"]') as HTMLInputElement);
    change(view.container.querySelector('[aria-label="Maths toolbar position"]') as HTMLSelectElement, "left");
    click(view.container.querySelector('[aria-label="Show custom commands toolbar"]') as HTMLInputElement);
    change(view.container.querySelector('[aria-label="Custom commands toolbar position"]') as HTMLSelectElement, "right");
    change(view.container.querySelector('[aria-label="Preview update mode"]') as HTMLSelectElement, "live");
    click(view.container.querySelector('[aria-label="Enable spelling, grammar and style checking"]') as HTMLInputElement);
    change(view.container.querySelector('[aria-label="Spell-check dialect"]') as HTMLSelectElement, "canadian");

    expect(input.onThemeChange.mock.calls.flat()).toEqual(["paper", "forest"]);
    expect(input.onFontChange).toHaveBeenCalledWith("fira");
    expect(input.onFontSizeChange).toHaveBeenCalledWith(18);
    expect(input.onMathToolbarEnabledChange).toHaveBeenCalledWith(false);
    expect(input.onMathToolbarPositionChange).toHaveBeenCalledWith("left");
    expect(input.onCustomToolbarEnabledChange).toHaveBeenCalledWith(false);
    expect(input.onCustomToolbarPositionChange).toHaveBeenCalledWith("right");
    expect(input.onBuildModeChange).toHaveBeenCalledWith("live");
    expect(input.onSpellcheckEnabledChange).toHaveBeenCalledWith(false);
    expect(input.onSpellcheckDialectChange).toHaveBeenCalledWith("canadian");
  });

  it("routes command editing, shortcut recording, reset, and every close affordance", () => {
    const input = props();
    const view = render(<SettingsPanel {...input} />);
    roots.push(view);
    change(view.container.querySelector('[aria-label="Custom command 1 label"]') as HTMLInputElement, "Lemma");
    change(view.container.querySelector('[aria-label="Custom command 1 template"]') as HTMLTextAreaElement, "\\begin{lemma}");
    expect(input.onCustomCommandChange).toHaveBeenNthCalledWith(1, 0, { label: "Lemma" });
    expect(input.onCustomCommandChange).toHaveBeenNthCalledWith(2, 0, { template: "\\begin{lemma}" });

    const buildRecorder = buttonByLabel(view.container, "Build document shortcut: F1");
    click(buildRecorder);
    keydown(buildRecorder, "b", { ctrlKey: true });
    expect(input.onKeybindingChange).toHaveBeenCalledWith("build", "Ctrl+B");
    click([...view.container.querySelectorAll("button")].find((button) => button.textContent === "Restore defaults")!);
    expect(input.onReset).toHaveBeenCalledOnce();
    click(buttonByLabel(view.container, "Close settings"));
    keydown(window, "Escape");
    act(() => view.container.querySelector(".settings-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(input.onClose).toHaveBeenCalledTimes(3);
  });

  it("disables dependent position and dialect controls", () => {
    const input = { ...props(), mathToolbarEnabled: false, customToolbarEnabled: false, spellcheckEnabled: false };
    const view = render(<SettingsPanel {...input} />);
    roots.push(view);
    expect((view.container.querySelector('[aria-label="Maths toolbar position"]') as HTMLSelectElement).disabled).toBe(true);
    expect((view.container.querySelector('[aria-label="Custom commands toolbar position"]') as HTMLSelectElement).disabled).toBe(true);
    expect((view.container.querySelector('[aria-label="Spell-check dialect"]') as HTMLSelectElement).disabled).toBe(true);
  });
});
