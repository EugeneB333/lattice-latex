import { describe, expect, it } from "vitest";
import {
  collectLatexContext,
  hasPairedEnvironmentAfterCursor,
  registerLatexLanguageFeatures,
  updateLatexProjectFiles,
  updateLatexProjectSources,
} from "./latexLanguage";

describe("collectLatexContext", () => {
  it("collects labels and bibliography identifiers", () => {
    const context = collectLatexContext(String.raw`
      \section{Introduction}\label{sec:intro}
      \begin{thebibliography}{9}
      \bibitem{knuth84} Donald Knuth
      \end{thebibliography}
      @article{lamport94, title={LaTeX}}
    `);

    expect(context.labels).toEqual(["sec:intro"]);
    expect(context.bibliographyKeys).toEqual(["knuth84", "lamport94"]);
  });

  it("keeps nested environments in opening order and removes closed ones", () => {
    const context = collectLatexContext(String.raw`
      \begin{document}
      \begin{figure}
      \begin{center}
      \end{center}
    `);

    expect(context.openEnvironments).toEqual(["document", "figure"]);
  });

  it("deduplicates repeated labels and keys", () => {
    const context = collectLatexContext(String.raw`
      \label{eq:one}\label{eq:one}
      \bibitem{source}\bibitem{source}
    `);

    expect(context.labels).toEqual(["eq:one"]);
    expect(context.bibliographyKeys).toEqual(["source"]);
  });

  it("discovers project-defined commands and environments", () => {
    const context = collectLatexContext(String.raw`
      \newcommand{\vect}[1]{\mathbf{#1}}
      \def\R{\mathbb{R}}
      \newenvironment{warning}{\bfseries}{\par}
    `);

    expect(context.customCommands).toEqual(["\\vect", "\\R"]);
    expect(context.customEnvironments).toEqual(["warning"]);
  });
});

describe("hasPairedEnvironmentAfterCursor", () => {
  it("recognises a mirrored environment-name placeholder", () => {
    expect(hasPairedEnvironmentAfterCursor("equ", "}\n\t\n\\end{equ}", "equation")).toBe(true);
    expect(hasPairedEnvironmentAfterCursor("", "environment}\n\t\n\\end{environment}", "equation")).toBe(true);
  });

  it("recognises a complete closing environment", () => {
    expect(hasPairedEnvironmentAfterCursor("eq", "}\ncontent\n\\end{equation}", "equation")).toBe(true);
  });

  it("allows a new closing environment when no pair exists", () => {
    expect(hasPairedEnvironmentAfterCursor("equ", "}", "equation")).toBe(false);
  });
});

describe("LaTeX language providers", () => {
  class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  }

  const providers: Record<string, { provideCompletionItems?: Function; provideSignatureHelp?: Function; provideHover?: Function }> = {};
  const monaco = {
    Range,
    languages: {
      setLanguageConfiguration: (_id: string, value: unknown) => { providers.configuration = value as never; },
      registerCompletionItemProvider: (_id: string, value: unknown) => { providers.completion = value as never; },
      registerSignatureHelpProvider: (_id: string, value: unknown) => { providers.signature = value as never; },
      registerHoverProvider: (_id: string, value: unknown) => { providers.hover = value as never; },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Class: 1, Reference: 2, Module: 3, File: 4, Function: 5 },
      IndentAction: { IndentOutdent: 1, Indent: 2, Outdent: 3 },
    },
    editor: { getModels: () => [{ getValue: () => String.raw`\newcommand{\projectcmd}{}\label{global:key}@book{globalbook,}` }] },
  };

  function model(line: string, after = "") {
    return {
      getLineContent: () => line,
      getLineCount: () => 1,
      getLineMaxColumn: () => line.length + after.length + 1,
      getValueInRange: (range: Range) => range.startColumn === 1 ? line.slice(0, range.endColumn - 1) : after,
    };
  }

  const position = (line: string) => ({ lineNumber: 1, column: line.length + 1 });

  registerLatexLanguageFeatures(monaco as never);

  it("configures comments, brackets, indentation, and enter behavior", () => {
    const config = providers.configuration as unknown as { comments: unknown; brackets: unknown[]; onEnterRules: unknown[] };
    expect(config.comments).toEqual({ lineComment: "%" });
    expect(config.brackets).toHaveLength(3);
    expect(config.onEnterRules).toHaveLength(3);
  });

  it.each([
    [String.raw`\ref{`, "global:key"],
    [String.raw`\citep{`, "globalbook"],
    [String.raw`\usepackage{`, "amsmath"],
    [String.raw`\documentclass{`, "article"],
  ])("completes context for %s", (line, expected) => {
    const result = providers.completion!.provideCompletionItems!(model(line), position(line));
    expect(result.suggestions.map((item: { label: string }) => item.label)).toContain(expected);
  });

  it("filters project files by command and removes .tex for input commands", () => {
    updateLatexProjectFiles(["chapters/intro.tex", "refs.bib", "figures/chart.png", "style.sty"]);
    const inputLine = String.raw`\input{`;
    const graphicsLine = String.raw`\includegraphics{`;
    const bibliographyLine = String.raw`\addbibresource{`;
    const input = providers.completion!.provideCompletionItems!(model(inputLine), position(inputLine)).suggestions;
    const graphics = providers.completion!.provideCompletionItems!(model(graphicsLine), position(graphicsLine)).suggestions;
    const bibliography = providers.completion!.provideCompletionItems!(model(bibliographyLine), position(bibliographyLine)).suggestions;
    expect(input.map((item: { insertText: string }) => item.insertText)).toEqual(["chapters/intro}", "style.sty}"]);
    expect(graphics.map((item: { label: string }) => item.label)).toEqual(["figures/chart.png"]);
    expect(bibliography.map((item: { label: string }) => item.label)).toEqual(["refs.bib"]);
  });

  it("offers built-in and project-defined commands without duplicating built-ins", () => {
    updateLatexProjectSources([String.raw`\newcommand{\textbf}{}\newcommand{\localcmd}{}`]);
    const line = "\\";
    const suggestions = providers.completion!.provideCompletionItems!(model(line), position(line)).suggestions;
    expect(suggestions.map((item: { label: string }) => item.label)).toContain("\\localcmd");
    expect(suggestions.filter((item: { label: string }) => item.label === "\\textbf")).toHaveLength(1);
  });

  it("inserts paired environments and avoids a duplicate closing command", () => {
    updateLatexProjectSources([String.raw`\newenvironment{warning}{}{}`]);
    const line = String.raw`\begin{equ`;
    const paired = providers.completion!.provideCompletionItems!(model(line, "}\nbody\n\\end{equation}"), position(line)).suggestions;
    const equation = paired.find((item: { label: string }) => item.label === "equation");
    expect(equation.insertText).toBe("equation");
    const unpaired = providers.completion!.provideCompletionItems!(model(line, "}"), position(line)).suggestions;
    expect(unpaired.find((item: { label: string }) => item.label === "equation").insertText).toContain("\\end{equation}");
    expect(unpaired.map((item: { label: string }) => item.label)).toContain("warning");
  });

  it("closes open environments from the innermost outward", () => {
    const line = String.raw`\begin{document}\begin{figure}\end{`;
    const result = providers.completion!.provideCompletionItems!(model(line), position(line));
    expect(result.suggestions.map((item: { label: string }) => item.label)).toEqual(["figure", "document"]);
  });

  it("returns no completions outside a command context", () => {
    const line = "ordinary prose";
    expect(providers.completion!.provideCompletionItems!(model(line), position(line)).suggestions).toEqual([]);
  });

  it("provides signatures with the active argument and ignores unknown commands", () => {
    const known = String.raw`\frac{a}{`;
    const help = providers.signature!.provideSignatureHelp!(model(known), position(known));
    expect(help.value.signatures[0].label).toContain("numerator");
    expect(help.value.activeParameter).toBe(1);
    const unknown = String.raw`\unknown{`;
    expect(providers.signature!.provideSignatureHelp!(model(unknown), position(unknown))).toBeNull();
  });

  it("provides command and environment hover help only under recognized tokens", () => {
    const commandLine = String.raw`Use \section{Title}`;
    const commandHover = providers.hover!.provideHover!(model(commandLine), { lineNumber: 1, column: 7 });
    expect(commandHover.contents[0].value).toContain("Create a section");
    const environmentLine = String.raw`\begin{figure}`;
    const environmentHover = providers.hover!.provideHover!(model(environmentLine), { lineNumber: 1, column: 9 });
    expect(environmentHover.contents[0].value).toContain("figure environment");
    expect(providers.hover!.provideHover!(model("plain"), { lineNumber: 1, column: 2 })).toBeNull();
  });
});
