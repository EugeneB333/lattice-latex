import type { Monaco } from "@monaco-editor/react";
import { Dialect, SuggestionKind, WorkerLinter, type Lint, type Linter } from "harper.js";
import { binary } from "harper.js/binary";
import type * as MonacoEditor from "monaco-editor";

export type SpellcheckDialectId = "american" | "british" | "australian" | "canadian" | "indian";

export type SpellcheckStatus = {
  phase: "disabled" | "loading" | "ready" | "error";
  issueCount: number;
  message?: string;
};

export type SpellcheckController = {
  configure: (enabled: boolean, dialect: SpellcheckDialectId) => void;
  dispose: () => void;
};

type PlainSuggestion = {
  kind: SuggestionKind;
  replacement: string;
};

type SpellcheckIssue = {
  start: number;
  end: number;
  kind: string;
  message: string;
  problem: string;
  suggestions: PlainSuggestion[];
  contextHash: string;
};

const MARKER_OWNER = "lattice-harper";
const CUSTOM_WORDS_KEY = "lattice-spellcheck-words";
const IGNORED_LINTS_KEY = "lattice-spellcheck-ignored";

const DIALECTS: Record<SpellcheckDialectId, Dialect> = {
  american: Dialect.American,
  british: Dialect.British,
  australian: Dialect.Australian,
  canadian: Dialect.Canadian,
  indian: Dialect.Indian,
};

const MATH_ENVIRONMENTS = new Set([
  "align", "align*", "alignat", "alignat*", "cases", "displaymath", "eqnarray", "eqnarray*",
  "equation", "equation*", "gather", "gather*", "math", "multline", "multline*", "split",
]);

const VERBATIM_ENVIRONMENTS = new Set(["Verbatim", "lstlisting", "minted", "verbatim", "verbatim*"]);
const COLUMN_SPEC_ENVIRONMENTS = new Set(["array", "tabular", "tabular*"]);

const NON_PROSE_COMMANDS = new Set([
  "addbibresource", "bibliography", "bibliographystyle", "cite", "citeauthor", "citep", "citet",
  "cref", "Cref", "documentclass", "eqref", "href", "include", "includegraphics", "input", "label",
  "end", "pageref", "ref", "url", "usepackage",
]);

function maskRange(chars: string[], source: string, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") chars[index] = " ";
  }
}

function escaped(source: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function groupEnd(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) return start;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (escaped(source, index)) continue;
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

function skipWhitespace(source: string, start: number) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

/**
 * Replaces LaTeX syntax with spaces while preserving every UTF-16 offset and newline.
 * Harper can therefore lint readable prose without suggesting edits to commands,
 * citation keys, file paths, comments, verbatim blocks, or mathematical notation.
 */
export function maskLatexForSpellcheck(source: string) {
  const chars = source.split("");
  let index = 0;

  while (index < source.length) {
    if (source[index] === "%" && !escaped(source, index)) {
      const end = source.indexOf("\n", index);
      const commentEnd = end === -1 ? source.length : end;
      maskRange(chars, source, index, commentEnd);
      index = commentEnd;
      continue;
    }

    if (source[index] === "$" && !escaped(source, index)) {
      const delimiterLength = source[index + 1] === "$" ? 2 : 1;
      let end = index + delimiterLength;
      while (end < source.length) {
        if (source.startsWith("$".repeat(delimiterLength), end) && !escaped(source, end)) {
          end += delimiterLength;
          break;
        }
        end += 1;
      }
      maskRange(chars, source, index, end);
      index = end;
      continue;
    }

    if (source[index] !== "\\") {
      if (source[index] === "~" || source[index] === "{" || source[index] === "}") chars[index] = " ";
      index += 1;
      continue;
    }

    if (source.startsWith("\\(", index) || source.startsWith("\\[", index)) {
      const close = source[index + 1] === "(" ? "\\)" : "\\]";
      const found = source.indexOf(close, index + 2);
      const end = found === -1 ? source.length : found + 2;
      maskRange(chars, source, index, end);
      index = end;
      continue;
    }

    const commandMatch = source.slice(index).match(/^\\([A-Za-z@]+|.)/);
    if (!commandMatch) {
      chars[index] = " ";
      index += 1;
      continue;
    }

    const command = commandMatch[1];
    let commandEnd = index + commandMatch[0].length;
    if (source[commandEnd] === "*") commandEnd += 1;

    if (command === "begin") {
      const argumentStart = skipWhitespace(source, commandEnd);
      const argumentEnd = groupEnd(source, argumentStart, "{", "}");
      const environment = source.slice(argumentStart + 1, Math.max(argumentStart + 1, argumentEnd - 1));
      if (MATH_ENVIRONMENTS.has(environment) || VERBATIM_ENVIRONMENTS.has(environment)) {
        const close = `\\end{${environment}}`;
        const closeStart = source.indexOf(close, argumentEnd);
        const end = closeStart === -1 ? source.length : closeStart + close.length;
        maskRange(chars, source, index, end);
        index = end;
        continue;
      }
      maskRange(chars, source, index, argumentEnd);
      let environmentEnd = skipWhitespace(source, argumentEnd);
      if (source[environmentEnd] === "[") environmentEnd = groupEnd(source, environmentEnd, "[", "]");
      environmentEnd = skipWhitespace(source, environmentEnd);
      if (COLUMN_SPEC_ENVIRONMENTS.has(environment) && source[environmentEnd] === "{") {
        environmentEnd = groupEnd(source, environmentEnd, "{", "}");
      }
      maskRange(chars, source, argumentEnd, environmentEnd);
      index = environmentEnd;
      continue;
    }

    maskRange(chars, source, index, commandEnd);
    index = commandEnd;

    if (NON_PROSE_COMMANDS.has(command)) {
      let cursor = skipWhitespace(source, index);
      while (source[cursor] === "[") {
        cursor = groupEnd(source, cursor, "[", "]");
        cursor = skipWhitespace(source, cursor);
      }
      if (source[cursor] === "{") cursor = groupEnd(source, cursor, "{", "}");
      // href's first argument is masked; its second argument remains visible prose.
      maskRange(chars, source, index, cursor);
      index = cursor;
    }
  }

  return chars.join("");
}

function readStoredWords() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_WORDS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === "string") : [];
  } catch {
    return [];
  }
}

function markerSeverity(monaco: Monaco, kind: string) {
  return kind === "Spelling" || kind === "Typo"
    ? monaco.MarkerSeverity.Warning
    : monaco.MarkerSeverity.Info;
}

function issueRange(model: MonacoEditor.editor.ITextModel, issue: SpellcheckIssue) {
  const start = model.getPositionAt(issue.start);
  const end = model.getPositionAt(Math.max(issue.start + 1, issue.end));
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function containsOffset(issue: SpellcheckIssue, start: number, end: number) {
  return issue.start <= end && issue.end >= start;
}

export function createSpellcheckController(
  monaco: Monaco,
  editor: MonacoEditor.editor.IStandaloneCodeEditor,
  enabled: boolean,
  dialect: SpellcheckDialectId,
  onStatus: (status: SpellcheckStatus) => void,
): SpellcheckController {
  let active = enabled;
  let selectedDialect = dialect;
  let disposed = false;
  let setupPromise: Promise<Linter> | undefined;
  let linter: WorkerLinter | undefined;
  let timer: number | undefined;
  let generation = 0;
  let issues: SpellcheckIssue[] = [];
  const clear = () => {
    issues = [];
    const model = editor.getModel();
    if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  };

  const setup = () => {
    if (!setupPromise) {
      onStatus({ phase: "loading", issueCount: 0 });
      // This module and worker are both created lazily, so disabling writing
      // assistance avoids downloading or initializing Harper's WebAssembly engine.
      linter = new WorkerLinter({ binary, dialect: DIALECTS[selectedDialect] });
      setupPromise = (async () => {
        await linter!.setup();
        await linter!.setLintConfig({ NoFrenchSpaces: false, Spaces: false, TransposedSpace: false });
        const words = readStoredWords();
        if (words.length) await linter!.importWords(words);
        const ignored = window.localStorage.getItem(IGNORED_LINTS_KEY);
        if (ignored) await linter!.importIgnoredLints(ignored);
        return linter!;
      })();
    }
    return setupPromise;
  };

  const check = async () => {
    window.clearTimeout(timer);
    const model = editor.getModel();
    const currentGeneration = ++generation;
    if (!active || !model || model.getLanguageId() !== "latex") {
      clear();
      onStatus({ phase: active ? "ready" : "disabled", issueCount: 0 });
      return;
    }

    try {
      const engine = await setup();
      if (disposed || currentGeneration !== generation) return;
      const source = model.getValue();
      const masked = maskLatexForSpellcheck(source);
      const lints = await engine.lint(masked, { language: "plaintext", dedup: true });
      if (disposed || currentGeneration !== generation || editor.getModel() !== model || model.getValue() !== source) {
        lints.forEach((lint) => lint.free());
        return;
      }

      const nextIssues = await Promise.all(lints.map(async (lint: Lint) => {
        const span = lint.span();
        const suggestions = lint.suggestions();
        try {
          const problem = source.slice(span.start, span.end);
          const maskedProblem = masked.slice(span.start, span.end);
          const kind = lint.lint_kind();
          if (!maskedProblem.trim() || ((kind === "Spelling" || kind === "Typo") && !/^[\p{L}\p{M}'’-]{2,}$/u.test(problem))) {
            return undefined;
          }
          return {
            start: span.start,
            end: span.end,
            kind,
            message: lint.message(),
            problem,
            suggestions: suggestions.map((suggestion) => ({
              kind: suggestion.kind(),
              replacement: suggestion.get_replacement_text(),
            })),
            contextHash: String(await engine.contextHash(masked, lint)),
          } satisfies SpellcheckIssue;
        } finally {
          span.free();
          suggestions.forEach((suggestion) => suggestion.free());
          lint.free();
        }
      }));

      issues = nextIssues.filter((issue): issue is SpellcheckIssue => issue !== undefined);
      monaco.editor.setModelMarkers(model, MARKER_OWNER, issues.map((issue) => ({
        ...issueRange(model, issue),
        severity: markerSeverity(monaco, issue.kind),
        source: "Harper",
        code: issue.kind,
        message: `${issue.message}\n\n${issue.kind} · checked privately on this device`,
      })));
      onStatus({ phase: "ready", issueCount: issues.length });
    } catch (error) {
      clear();
      onStatus({ phase: "error", issueCount: 0, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const schedule = (delay = 420) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void check(), delay);
  };

  const addWordCommand = monaco.editor.registerCommand("lattice.spellcheck.addWord", async (_accessor: unknown, word: string) => {
    const engine = await setup();
    const words = new Set(readStoredWords());
    words.add(word);
    await engine.importWords([...words]);
    window.localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify([...words].sort((a, b) => a.localeCompare(b))));
    schedule(0);
  });

  const ignoreCommand = monaco.editor.registerCommand("lattice.spellcheck.ignore", async (_accessor: unknown, hash: string) => {
    const engine = await setup();
    await engine.ignoreLintHash(BigInt(hash));
    window.localStorage.setItem(IGNORED_LINTS_KEY, await engine.exportIgnoredLints());
    schedule(0);
  });

  const codeActions = monaco.languages.registerCodeActionProvider("latex", {
    provideCodeActions(model: MonacoEditor.editor.ITextModel, range: MonacoEditor.Range) {
      if (model !== editor.getModel()) return { actions: [], dispose: () => undefined };
      const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
      const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
      const actions: MonacoEditor.languages.CodeAction[] = [];

      for (const issue of issues.filter((candidate) => containsOffset(candidate, start, end))) {
        const rangeToReplace = issueRange(model, issue);
        issue.suggestions.slice(0, 8).forEach((suggestion, suggestionIndex) => {
          const editRange = suggestion.kind === SuggestionKind.InsertAfter
            ? { ...rangeToReplace, startLineNumber: rangeToReplace.endLineNumber, startColumn: rangeToReplace.endColumn }
            : rangeToReplace;
          actions.push({
            title: suggestion.kind === SuggestionKind.Remove
              ? `Remove “${issue.problem}”`
              : `Replace with “${suggestion.replacement}”`,
            kind: "quickfix",
            isPreferred: suggestionIndex === 0,
            edit: { edits: [{
              resource: model.uri,
              versionId: model.getVersionId(),
              textEdit: { range: editRange, text: suggestion.replacement },
            }] },
          });
        });
        if (/^[\p{L}\p{M}'’-]+$/u.test(issue.problem)) {
          actions.push({
            title: `Add “${issue.problem}” to dictionary`,
            kind: "quickfix",
            command: { id: "lattice.spellcheck.addWord", title: "Add to dictionary", arguments: [issue.problem] },
          });
        }
        actions.push({
          title: "Ignore this suggestion",
          kind: "quickfix",
          command: { id: "lattice.spellcheck.ignore", title: "Ignore suggestion", arguments: [issue.contextHash] },
        });
      }

      return { actions, dispose: () => undefined };
    },
  });

  const contentListener = editor.onDidChangeModelContent(() => schedule());
  const modelListener = editor.onDidChangeModel(() => schedule(0));
  if (active) schedule(0);
  else onStatus({ phase: "disabled", issueCount: 0 });

  return {
    configure(nextEnabled, nextDialect) {
      const dialectChanged = selectedDialect !== nextDialect;
      active = nextEnabled;
      selectedDialect = nextDialect;
      if (!active) {
        generation += 1;
        clear();
        onStatus({ phase: "disabled", issueCount: 0 });
        return;
      }
      if (dialectChanged) void setup().then(async (engine) => {
        await engine.setDialect(DIALECTS[nextDialect]);
        await engine.setLintConfig({ NoFrenchSpaces: false, Spaces: false, TransposedSpace: false });
        const words = readStoredWords();
        if (words.length) await engine.importWords(words);
        const ignored = window.localStorage.getItem(IGNORED_LINTS_KEY);
        if (ignored) await engine.importIgnoredLints(ignored);
      }).then(() => schedule(0));
      else schedule(0);
    },
    dispose() {
      disposed = true;
      generation += 1;
      window.clearTimeout(timer);
      clear();
      contentListener.dispose();
      modelListener.dispose();
      codeActions.dispose();
      addWordCommand.dispose();
      ignoreCommand.dispose();
      void linter?.dispose();
    },
  };
}
