import { describe, expect, it, vi } from "vitest";
import { configureMonaco, THEMES } from "./editorThemes";

function monacoStub(existing: string[] = []) {
  class Range {
    constructor(..._args: number[]) {}
  }
  return {
    Range,
    MarkerSeverity: { Warning: 4, Info: 2 },
    languages: {
      getLanguages: vi.fn(() => existing.map((id) => ({ id }))),
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      registerCompletionItemProvider: vi.fn(),
      registerSignatureHelpProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Class: 1, Reference: 2, Module: 3, File: 4, Function: 5 },
      IndentAction: { IndentOutdent: 1, Indent: 2, Outdent: 3 },
    },
    editor: {
      defineTheme: vi.fn(),
      getModels: vi.fn(() => []),
    },
  };
}

describe("editor themes", () => {
  it("defines a complete, unique theme catalogue", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["lattice", "midnight", "forest", "paper"]);
    expect(new Set(THEMES.map((theme) => theme.monaco)).size).toBe(THEMES.length);
    for (const theme of THEMES) expect(theme.browserColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("registers missing languages, tokenizers, language features, and every theme", () => {
    const monaco = monacoStub();
    configureMonaco(monaco as never);

    expect(monaco.languages.register).toHaveBeenCalledWith({ id: "latex", extensions: [".tex", ".sty", ".cls"], aliases: ["LaTeX", "latex"] });
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: "bibtex", extensions: [".bib"], aliases: ["BibTeX", "bibtex"] });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith("latex", expect.objectContaining({ comments: { lineComment: "%" } }));
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith("latex", expect.any(Object));
    expect(monaco.languages.registerSignatureHelpProvider).toHaveBeenCalledWith("latex", expect.any(Object));
    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledWith("latex", expect.any(Object));
    expect(monaco.editor.defineTheme.mock.calls.map((call) => call[0])).toEqual(THEMES.map((theme) => theme.monaco));
  });

  it("does not re-register languages already supplied by Monaco", () => {
    const monaco = monacoStub(["latex", "bibtex"]);
    configureMonaco(monaco as never);
    expect(monaco.languages.register).not.toHaveBeenCalled();
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(2);
    expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(4);
  });

  it("defines light and dark themes with syntax rules and editor colors", () => {
    const monaco = monacoStub(["latex", "bibtex"]);
    configureMonaco(monaco as never);
    const definitions = monaco.editor.defineTheme.mock.calls.map(([name, definition]) => ({ name, definition }));
    expect(definitions.find((item) => item.name === "lattice-paper")?.definition.base).toBe("vs");
    for (const { definition } of definitions) {
      expect(definition.inherit).toBe(true);
      expect(definition.rules).toEqual(expect.arrayContaining([
        expect.objectContaining({ token: "keyword.command" }),
        expect.objectContaining({ token: "comment", fontStyle: "italic" }),
      ]));
      expect(definition.colors["editor.background"]).toMatch(/^#/);
      expect(definition.colors["editorCursor.foreground"]).toMatch(/^#/);
    }
  });
});
