import type { Monaco } from "@monaco-editor/react";
import { registerLatexLanguageFeatures } from "./latexLanguage";

export type ThemeId = "lattice" | "midnight" | "forest" | "paper";

export const THEMES: { id: ThemeId; label: string; monaco: string; browserColor: string }[] = [
  { id: "lattice", label: "Lattice Dark", monaco: "lattice-dark", browserColor: "#11120f" },
  { id: "midnight", label: "Midnight", monaco: "lattice-midnight", browserColor: "#0b1020" },
  { id: "forest", label: "Evergreen", monaco: "lattice-forest", browserColor: "#0d1512" },
  { id: "paper", label: "Paper Light", monaco: "lattice-paper", browserColor: "#f4f1e8" },
];

const latexTokens = {
  defaultToken: "",
  tokenPostfix: ".latex",
  brackets: [
    { open: "{", close: "}", token: "delimiter.curly" },
    { open: "[", close: "]", token: "delimiter.square" },
    { open: "(", close: ")", token: "delimiter.parenthesis" },
  ],
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\$\$/, { token: "delimiter.math", next: "@mathDisplay" }],
      [/\$/, { token: "delimiter.math", next: "@mathInline" }],
      [/\\\[/, { token: "delimiter.math", next: "@mathDisplayBracket" }],
      [/``[^']*''/, "string"],
      [/\\(?:begin|end)\s*\{/, { token: "keyword.environment", next: "@environment" }],
      [/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?/, "keyword.heading"],
      [/\\(?:newcommand|renewcommand|providecommand|def|gdef|edef|xdef|let|newenvironment|renewenvironment|DeclareMathOperator)\b/, "keyword.definition"],
      [/\\(?:label|ref|pageref|eqref|autoref|cref|Cref|cite|citep|citet|nocite|bibliography|addbibresource)\b/, "keyword.reference"],
      [/\\(?:textbf|textit|texttt|textsc|emph|underline|mbox|mathrm|mathbf|mathit|mathsf|mathtt|operatorname)\b/, "keyword.format"],
      [/\\(?:documentclass|usepackage|RequirePackage|input|include|includegraphics|begin|end|title|author|date|maketitle)\b/, "keyword.structure"],
      [/\\[a-zA-Z@]+\*?|\\./, "keyword.command"],
      [/[{}\[\]()]/, "delimiter"],
      [/&/, "delimiter.ampersand"],
      [/~|--?|-{3}/, "operator"],
      [/\b\d+(?:\.\d+)?\b/, "number"],
    ],
    environment: [
      [/[^}]+/, "type.environment"],
      [/\}/, { token: "keyword.environment", next: "@pop" }],
    ],
    mathInline: [
      [/\$/, { token: "delimiter.math", next: "@pop" }],
      { include: "@mathContent" },
    ],
    mathDisplay: [
      [/\$\$/, { token: "delimiter.math", next: "@pop" }],
      { include: "@mathContent" },
    ],
    mathDisplayBracket: [
      [/\\\]/, { token: "delimiter.math", next: "@pop" }],
      { include: "@mathContent" },
    ],
    mathContent: [
      [/%.*$/, "comment"],
      [/\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|iiint|lim|log|ln|sin|cos|tan|max|min|left|right|begin|end)\b/, "keyword.math"],
      [/\\[a-zA-Z@]+|\\./, "keyword.command"],
      [/\b\d+(?:\.\d+)?\b/, "number"],
      [/[+\-*/=<>^_|,:;!]+/, "operator.math"],
      [/[{}\[\]()]/, "delimiter.math"],
      [/[a-zA-Z]+/, "variable.math"],
      [/./, "string.math"],
    ],
  },
};

const bibtexTokens = {
  defaultToken: "",
  tokenPostfix: ".bibtex",
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/@[a-zA-Z]+/, "keyword.entry"],
      [/[a-zA-Z][\w-]*(?=\s*=)/, "type.attribute"],
      [/"/, { token: "string.quote", next: "@quotedString" }],
      [/[{}(),=]/, "delimiter"],
      [/\b\d+\b/, "number"],
      [/#[a-zA-Z]+/, "keyword.command"],
    ],
    quotedString: [
      [/[^"\\]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],
  },
};

function themeRules(colors: {
  command: string;
  definition: string;
  environment: string;
  environmentName: string;
  format: string;
  heading: string;
  math: string;
  number: string;
  reference: string;
  string: string;
  structure: string;
  comment: string;
}) {
  return [
    { token: "keyword.command", foreground: colors.command },
    { token: "keyword.structure", foreground: colors.structure, fontStyle: "bold" },
    { token: "keyword.environment", foreground: colors.environment, fontStyle: "bold" },
    { token: "type.environment", foreground: colors.environmentName },
    { token: "keyword.heading", foreground: colors.heading, fontStyle: "bold" },
    { token: "keyword.definition", foreground: colors.definition },
    { token: "keyword.reference", foreground: colors.reference },
    { token: "keyword.format", foreground: colors.format },
    { token: "keyword.math", foreground: colors.math, fontStyle: "bold" },
    { token: "variable.math", foreground: colors.math, fontStyle: "italic" },
    { token: "delimiter.math", foreground: colors.math },
    { token: "operator.math", foreground: colors.definition },
    { token: "keyword.entry", foreground: colors.heading, fontStyle: "bold" },
    { token: "type.attribute", foreground: colors.command },
    { token: "number", foreground: colors.number },
    { token: "string", foreground: colors.string },
    { token: "comment", foreground: colors.comment, fontStyle: "italic" },
  ];
}

export function configureMonaco(monaco: Monaco) {
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === "latex")) {
    monaco.languages.register({ id: "latex", extensions: [".tex", ".sty", ".cls"], aliases: ["LaTeX", "latex"] });
  }
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === "bibtex")) {
    monaco.languages.register({ id: "bibtex", extensions: [".bib"], aliases: ["BibTeX", "bibtex"] });
  }
  monaco.languages.setMonarchTokensProvider("latex", latexTokens);
  monaco.languages.setMonarchTokensProvider("bibtex", bibtexTokens);
  registerLatexLanguageFeatures(monaco);

  monaco.editor.defineTheme("lattice-dark", {
    base: "vs-dark",
    inherit: true,
    rules: themeRules({ command: "77B6BD", structure: "D9A25F", environment: "79A8D1", environmentName: "C5A76C", heading: "E68767", definition: "E07A72", reference: "C898C3", format: "9FB689", math: "B6A0D6", number: "D6A85E", string: "9FB689", comment: "6E716B" }),
    colors: { "editor.background": "#151613", "editor.foreground": "#D9D8D0", "editorLineNumber.foreground": "#555850", "editorLineNumber.activeForeground": "#B8B9B0", "editor.selectionBackground": "#3D4C3A", "editor.inactiveSelectionBackground": "#30372D", "editorCursor.foreground": "#E68767", "editorIndentGuide.background1": "#292A26", "editor.lineHighlightBackground": "#191A16" },
  });
  monaco.editor.defineTheme("lattice-midnight", {
    base: "vs-dark",
    inherit: true,
    rules: themeRules({ command: "89DDFF", structure: "FFCB6B", environment: "82AAFF", environmentName: "FFD580", heading: "C792EA", definition: "F07178", reference: "C792EA", format: "C3E88D", math: "D9A6FF", number: "F78C6C", string: "C3E88D", comment: "63708A" }),
    colors: { "editor.background": "#0F1526", "editor.foreground": "#D8E0F0", "editorLineNumber.foreground": "#46516A", "editorLineNumber.activeForeground": "#AFC1E3", "editor.selectionBackground": "#344B70", "editor.inactiveSelectionBackground": "#273854", "editorCursor.foreground": "#82AAFF", "editorIndentGuide.background1": "#232D44", "editor.lineHighlightBackground": "#151D31" },
  });
  monaco.editor.defineTheme("lattice-forest", {
    base: "vs-dark",
    inherit: true,
    rules: themeRules({ command: "7FC7A4", structure: "D7B66F", environment: "69B7D0", environmentName: "D6B875", heading: "E6A96B", definition: "E08073", reference: "C59AD8", format: "B7D57A", math: "D6B4E8", number: "DFA4A4", string: "B7D57A", comment: "62796D" }),
    colors: { "editor.background": "#101A16", "editor.foreground": "#D7E3DB", "editorLineNumber.foreground": "#4B6157", "editorLineNumber.activeForeground": "#AFC6BA", "editor.selectionBackground": "#315844", "editor.inactiveSelectionBackground": "#284638", "editorCursor.foreground": "#74CAA0", "editorIndentGuide.background1": "#213129", "editor.lineHighlightBackground": "#15221D" },
  });
  monaco.editor.defineTheme("lattice-paper", {
    base: "vs",
    inherit: true,
    rules: themeRules({ command: "315C8C", structure: "956125", environment: "2E6D86", environmentName: "8A632A", heading: "9B3D42", definition: "B94848", reference: "75518A", format: "527A3A", math: "7750A3", number: "A35B2E", string: "527A3A", comment: "8B867B" }),
    colors: { "editor.background": "#FAF8F2", "editor.foreground": "#34332F", "editorLineNumber.foreground": "#B1AA9C", "editorLineNumber.activeForeground": "#655F54", "editor.selectionBackground": "#C9DDF1", "editor.inactiveSelectionBackground": "#DFE9F2", "editorCursor.foreground": "#9B3D42", "editorIndentGuide.background1": "#E3DED3", "editor.lineHighlightBackground": "#F4F0E7" },
  });
}
