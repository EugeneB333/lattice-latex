import type { Monaco } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";

type CommandSpec = {
  label: string;
  insert: string;
  signature: string;
  detail: string;
  documentation: string;
};

type EnvironmentSpec = {
  name: string;
  detail: string;
};

export type LatexContext = {
  labels: string[];
  bibliographyKeys: string[];
  openEnvironments: string[];
  customCommands: string[];
  customEnvironments: string[];
};

const COMMANDS: CommandSpec[] = [
  { label: "\\documentclass", insert: "\\documentclass[${1:options}]{${2:article}}", signature: "\\documentclass[options]{class}", detail: "Set the document class", documentation: "Declares the document class. Common classes include `article`, `report`, `book`, `letter`, and `beamer`." },
  { label: "\\usepackage", insert: "\\usepackage[${1:options}]{${2:package}}", signature: "\\usepackage[options]{package}", detail: "Load a package", documentation: "Loads a LaTeX package, optionally with a comma-separated list of options." },
  { label: "\\begin", insert: "\\begin{${1:environment}}\n\t$0\n\\end{${1:environment}}", signature: "\\begin{environment}", detail: "Begin and close an environment", documentation: "Starts an environment and inserts its matching `\\end` command." },
  { label: "\\end", insert: "\\end{${1:environment}}", signature: "\\end{environment}", detail: "End an environment", documentation: "Closes the nearest matching environment." },
  { label: "\\section", insert: "\\section{${1:title}}", signature: "\\section{title}", detail: "Create a section", documentation: "Adds a numbered section heading. Use `\\section*` for an unnumbered heading." },
  { label: "\\subsection", insert: "\\subsection{${1:title}}", signature: "\\subsection{title}", detail: "Create a subsection", documentation: "Adds a numbered subsection heading." },
  { label: "\\subsubsection", insert: "\\subsubsection{${1:title}}", signature: "\\subsubsection{title}", detail: "Create a subsubsection", documentation: "Adds a numbered third-level section heading." },
  { label: "\\chapter", insert: "\\chapter{${1:title}}", signature: "\\chapter{title}", detail: "Create a chapter", documentation: "Adds a chapter heading in document classes that support chapters." },
  { label: "\\paragraph", insert: "\\paragraph{${1:title}}", signature: "\\paragraph{title}", detail: "Create a paragraph heading", documentation: "Adds a run-in paragraph heading." },
  { label: "\\title", insert: "\\title{${1:title}}", signature: "\\title{title}", detail: "Set the document title", documentation: "Defines the title used by `\\maketitle`." },
  { label: "\\author", insert: "\\author{${1:name}}", signature: "\\author{name}", detail: "Set the document author", documentation: "Defines the author used by `\\maketitle`." },
  { label: "\\date", insert: "\\date{${1:\\today}}", signature: "\\date{date}", detail: "Set the document date", documentation: "Defines the date used by `\\maketitle`." },
  { label: "\\maketitle", insert: "\\maketitle", signature: "\\maketitle", detail: "Typeset title information", documentation: "Typesets the title, author, and date defined in the preamble." },
  { label: "\\textbf", insert: "\\textbf{${1:text}}", signature: "\\textbf{text}", detail: "Bold text", documentation: "Typesets its argument using a bold font weight." },
  { label: "\\textit", insert: "\\textit{${1:text}}", signature: "\\textit{text}", detail: "Italic text", documentation: "Typesets its argument using an italic font shape." },
  { label: "\\texttt", insert: "\\texttt{${1:text}}", signature: "\\texttt{text}", detail: "Monospaced text", documentation: "Typesets its argument using the typewriter font family." },
  { label: "\\emph", insert: "\\emph{${1:text}}", signature: "\\emph{text}", detail: "Emphasise text", documentation: "Applies context-aware emphasis, normally italics in upright text." },
  { label: "\\underline", insert: "\\underline{${1:text}}", signature: "\\underline{text}", detail: "Underline text", documentation: "Draws a line beneath its argument." },
  { label: "\\label", insert: "\\label{${1:key}}", signature: "\\label{key}", detail: "Create a cross-reference target", documentation: "Assigns a key to the current numbered element for later cross-referencing." },
  { label: "\\ref", insert: "\\ref{${1:key}}", signature: "\\ref{key}", detail: "Insert a cross-reference", documentation: "Prints the number of the element identified by a `\\label`." },
  { label: "\\eqref", insert: "\\eqref{${1:key}}", signature: "\\eqref{key}", detail: "Reference an equation", documentation: "Prints an equation reference with parentheses. Provided by `amsmath`." },
  { label: "\\pageref", insert: "\\pageref{${1:key}}", signature: "\\pageref{key}", detail: "Reference a page", documentation: "Prints the page number containing the matching label." },
  { label: "\\cite", insert: "\\cite{${1:key}}", signature: "\\cite{key}", detail: "Insert a citation", documentation: "Cites one or more bibliography entries." },
  { label: "\\citep", insert: "\\citep{${1:key}}", signature: "\\citep{key}", detail: "Insert a parenthetical citation", documentation: "Creates a parenthetical citation when supported by the bibliography package." },
  { label: "\\citet", insert: "\\citet{${1:key}}", signature: "\\citet{key}", detail: "Insert a textual citation", documentation: "Creates a textual citation when supported by the bibliography package." },
  { label: "\\footnote", insert: "\\footnote{${1:text}}", signature: "\\footnote{text}", detail: "Insert a footnote", documentation: "Adds a numbered footnote at the current position." },
  { label: "\\url", insert: "\\url{${1:https://example.com}}", signature: "\\url{address}", detail: "Typeset a URL", documentation: "Typesets a URL. Usually provided by `url` or `hyperref`." },
  { label: "\\href", insert: "\\href{${1:url}}{${2:text}}", signature: "\\href{url}{text}", detail: "Create a hyperlink", documentation: "Creates a hyperlink using the `hyperref` package." },
  { label: "\\input", insert: "\\input{${1:file}}", signature: "\\input{file}", detail: "Insert another source file", documentation: "Reads another LaTeX source file at this position." },
  { label: "\\include", insert: "\\include{${1:file}}", signature: "\\include{file}", detail: "Include a source file", documentation: "Includes a source file with page management suitable for chapters." },
  { label: "\\includegraphics", insert: "\\includegraphics[${1:width=\\linewidth}]{${2:file}}", signature: "\\includegraphics[options]{file}", detail: "Insert an image", documentation: "Inserts an image using the `graphicx` package." },
  { label: "\\caption", insert: "\\caption{${1:caption}}", signature: "\\caption{caption}", detail: "Add a float caption", documentation: "Adds a numbered caption to a figure or table." },
  { label: "\\item", insert: "\\item ${1:text}", signature: "\\item[label] text", detail: "Add a list item", documentation: "Starts an item inside an `itemize`, `enumerate`, or `description` environment." },
  { label: "\\newcommand", insert: "\\newcommand{\\${1:name}}[${2:args}]{${3:definition}}", signature: "\\newcommand{\\name}[args]{definition}", detail: "Define a command", documentation: "Defines a new LaTeX command." },
  { label: "\\renewcommand", insert: "\\renewcommand{\\${1:name}}[${2:args}]{${3:definition}}", signature: "\\renewcommand{\\name}[args]{definition}", detail: "Redefine a command", documentation: "Changes the definition of an existing LaTeX command." },
  { label: "\\frac", insert: "\\frac{${1:numerator}}{${2:denominator}}", signature: "\\frac{numerator}{denominator}", detail: "Typeset a fraction", documentation: "Creates a fraction in math mode." },
  { label: "\\sqrt", insert: "\\sqrt[${1:index}]{${2:radicand}}", signature: "\\sqrt[index]{radicand}", detail: "Typeset a root", documentation: "Creates a square root or an indexed root in math mode." },
  { label: "\\sum", insert: "\\sum_{${1:i=1}}^{${2:n}}", signature: "\\sum_{lower}^{upper}", detail: "Summation operator", documentation: "Inserts a summation operator with lower and upper limits." },
  { label: "\\int", insert: "\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\,d${4:x}", signature: "\\int_{lower}^{upper}", detail: "Integral operator", documentation: "Inserts an integral with optional limits." },
  { label: "\\mathbf", insert: "\\mathbf{${1:x}}", signature: "\\mathbf{symbol}", detail: "Bold math symbols", documentation: "Uses the bold math alphabet for Latin letters and digits." },
  { label: "\\mathbb", insert: "\\mathbb{${1:R}}", signature: "\\mathbb{symbol}", detail: "Blackboard-bold symbols", documentation: "Uses a blackboard-bold math alphabet, commonly provided by `amsfonts` or `amssymb`." },
];

const ENVIRONMENTS: EnvironmentSpec[] = [
  { name: "document", detail: "Document body" },
  { name: "abstract", detail: "Abstract" },
  { name: "itemize", detail: "Bulleted list" },
  { name: "enumerate", detail: "Numbered list" },
  { name: "description", detail: "Description list" },
  { name: "figure", detail: "Floating figure" },
  { name: "figure*", detail: "Full-width floating figure" },
  { name: "table", detail: "Floating table" },
  { name: "table*", detail: "Full-width floating table" },
  { name: "tabular", detail: "Tabular content" },
  { name: "equation", detail: "Numbered display equation" },
  { name: "equation*", detail: "Unnumbered display equation" },
  { name: "align", detail: "Aligned equations" },
  { name: "align*", detail: "Unnumbered aligned equations" },
  { name: "gather", detail: "Gathered equations" },
  { name: "multline", detail: "Multiline equation" },
  { name: "matrix", detail: "Matrix" },
  { name: "pmatrix", detail: "Parenthesised matrix" },
  { name: "bmatrix", detail: "Bracketed matrix" },
  { name: "cases", detail: "Piecewise cases" },
  { name: "theorem", detail: "Theorem block" },
  { name: "proof", detail: "Proof block" },
  { name: "verbatim", detail: "Verbatim text" },
  { name: "minipage", detail: "Independent page fragment" },
  { name: "center", detail: "Centred content" },
  { name: "flushleft", detail: "Left-aligned content" },
  { name: "flushright", detail: "Right-aligned content" },
];

const PACKAGES = ["amsmath", "amssymb", "amsfonts", "mathtools", "geometry", "graphicx", "xcolor", "hyperref", "cleveref", "booktabs", "array", "tabularx", "longtable", "microtype", "fontspec", "babel", "polyglossia", "biblatex", "natbib", "tikz", "pgfplots", "siunitx", "listings", "minted", "caption", "subcaption", "enumitem", "fancyhdr"];
const DOCUMENT_CLASSES = ["article", "report", "book", "letter", "beamer", "memoir", "scrartcl", "scrreprt", "scrbook", "standalone"];

let projectFiles: string[] = [];
let projectSources: string[] = [];
let registered = false;

export function updateLatexProjectFiles(files: string[]) {
  projectFiles = files;
}

export function updateLatexProjectSources(sources: string[]) {
  projectSources = sources;
}

export function hasPairedEnvironmentAfterCursor(partialName: string, textAfterCursor: string, candidateName: string) {
  if (partialName && textAfterCursor.includes(`\\end{${partialName}}`)) return true;
  if (/^([^}\r\n]+)\}[\s\S]*?\\end\{\1\}/.test(textAfterCursor)) return true;
  return textAfterCursor.includes(`\\end{${candidateName}}`);
}

export function collectLatexContext(source: string): LatexContext {
  const labels = new Set<string>();
  const bibliographyKeys = new Set<string>();
  const customCommands = new Set<string>();
  const customEnvironments = new Set<string>();
  const openEnvironments: string[] = [];
  let match: RegExpExecArray | null;

  const labelPattern = /\\label\s*\{([^}]+)\}/g;
  while ((match = labelPattern.exec(source))) labels.add(match[1].trim());

  const bibItemPattern = /\\bibitem(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  while ((match = bibItemPattern.exec(source))) bibliographyKeys.add(match[1].trim());

  const entryPattern = /@[a-zA-Z]+\s*\{\s*([^,\s}]+)/g;
  while ((match = entryPattern.exec(source))) bibliographyKeys.add(match[1].trim());

  const commandDefinitionPattern = /\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\s*(\\[a-zA-Z@]+)\s*\}?/g;
  while ((match = commandDefinitionPattern.exec(source))) customCommands.add(match[1]);
  const primitiveDefinitionPattern = /\\(?:def|gdef|edef|xdef)\s*(\\[a-zA-Z@]+)/g;
  while ((match = primitiveDefinitionPattern.exec(source))) customCommands.add(match[1]);

  const environmentDefinitionPattern = /\\(?:newenvironment|renewenvironment)\*?\s*\{([^}]+)\}/g;
  while ((match = environmentDefinitionPattern.exec(source))) customEnvironments.add(match[1].trim());

  const environmentPattern = /\\(begin|end)\s*\{([^}]+)\}/g;
  while ((match = environmentPattern.exec(source))) {
    const name = match[2].trim();
    if (match[1] === "begin") {
      openEnvironments.push(name);
    } else {
      const matchingIndex = openEnvironments.lastIndexOf(name);
      if (matchingIndex >= 0) openEnvironments.splice(matchingIndex, 1);
    }
  }

  return { labels: [...labels], bibliographyKeys: [...bibliographyKeys], openEnvironments, customCommands: [...customCommands], customEnvironments: [...customEnvironments] };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function registerLatexLanguageFeatures(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.setLanguageConfiguration("latex", {
    comments: { lineComment: "%" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "$", close: "$", notIn: ["comment"] },
      { open: "`", close: "'", notIn: ["comment"] },
    ],
    surroundingPairs: [["{", "}"], ["[", "]"], ["(", ")"], ["$", "$"]],
    folding: { markers: { start: /^\s*%\s*region\b/, end: /^\s*%\s*endregion\b/ } },
    indentationRules: {
      increaseIndentPattern: /\\begin\s*\{[^}]+\}(?!.*\\end)/,
      decreaseIndentPattern: /^\s*\\end\s*\{[^}]+\}/,
    },
    onEnterRules: [
      { beforeText: /\\begin\s*\{[^}]+\}\s*$/, afterText: /^\s*\\end\s*\{[^}]+\}/, action: { indentAction: monaco.languages.IndentAction.IndentOutdent } },
      { beforeText: /\\begin\s*\{[^}]+\}\s*$/, action: { indentAction: monaco.languages.IndentAction.Indent } },
      { beforeText: /^\s*\\end\s*\{[^}]+\}/, action: { indentAction: monaco.languages.IndentAction.Outdent } },
    ],
  });

  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["\\", "{", ","],
    provideCompletionItems(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const replaceAfter = (index: number, includeClosingBrace = false) => new monaco.Range(
        position.lineNumber,
        index + 2,
        position.lineNumber,
        position.column + (includeClosingBrace && model.getLineContent(position.lineNumber)[position.column - 1] === "}" ? 1 : 0),
      );
      const snippetRule = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const allModels = monaco.editor.getModels().map((item: MonacoEditor.editor.ITextModel) => item.getValue()).join("\n");
      const allSources = `${allModels}\n${projectSources.join("\n")}`;
      const documentBeforeCursor = model.getValueInRange(new monaco.Range(1, 1, position.lineNumber, position.column));
      const localContext = collectLatexContext(documentBeforeCursor);
      const globalContext = collectLatexContext(allSources);

      const beginMatch = linePrefix.match(/\\begin\s*\{([^}]*)$/);
      if (beginMatch) {
        const start = linePrefix.lastIndexOf("{");
        const textAfterCursor = model.getValueInRange(new monaco.Range(
          position.lineNumber,
          position.column,
          model.getLineCount(),
          model.getLineMaxColumn(model.getLineCount()),
        ));
        const hasMirroredEnd = Boolean(beginMatch[1]) && textAfterCursor.includes(`\\end{${beginMatch[1]}}`);
        const hasMirroredPlaceholder = /^([^}\r\n]+)\}[\s\S]*?\\end\{\1\}/.test(textAfterCursor);
        const environments = [
          ...ENVIRONMENTS,
          ...globalContext.customEnvironments.filter((name) => !ENVIRONMENTS.some((item) => item.name === name)).map((name) => ({ name, detail: "Project-defined environment" })),
        ];
        return { suggestions: environments.map((environment) => {
          const hasExistingEnd = hasPairedEnvironmentAfterCursor(beginMatch[1], textAfterCursor, environment.name);
          return {
            label: environment.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: environment.detail,
            documentation: `Inserts a \`${environment.name}\` environment and its matching closing command.`,
            insertText: hasExistingEnd ? environment.name : `${environment.name}}\n\t$0\n\\end{${environment.name}}`,
            insertTextRules: snippetRule,
            range: replaceAfter(start, !hasExistingEnd),
            sortText: `0-${environment.name}`,
            command: hasMirroredEnd || hasMirroredPlaceholder
              ? { id: "jumpToNextSnippetPlaceholder", title: "Move to environment body" }
              : undefined,
          };
        }) };
      }

      const endMatch = linePrefix.match(/\\end\s*\{([^}]*)$/);
      if (endMatch) {
        const start = linePrefix.lastIndexOf("{");
        return { suggestions: [...localContext.openEnvironments].reverse().map((name, index) => ({
          label: name,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: index === 0 ? "Close the innermost environment" : "Close an open environment",
          insertText: `${name}}`,
          range: replaceAfter(start, true),
          sortText: `0-${String(index).padStart(2, "0")}`,
        })) };
      }

      const referenceMatch = linePrefix.match(/\\(?:ref|pageref|eqref|autoref|cref|Cref)\s*\{([^}]*)$/);
      if (referenceMatch) {
        const start = linePrefix.lastIndexOf("{");
        return { suggestions: unique(globalContext.labels).map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Reference,
          detail: "Document label",
          insertText: `${label}}`,
          range: replaceAfter(start, true),
        })) };
      }

      const citationMatch = linePrefix.match(/\\(?:cite|citep|citet|autocite|parencite|textcite)\s*\{([^}]*)$/);
      if (citationMatch) {
        const start = Math.max(linePrefix.lastIndexOf("{"), linePrefix.lastIndexOf(","));
        return { suggestions: unique(globalContext.bibliographyKeys).map((key) => ({
          label: key,
          kind: monaco.languages.CompletionItemKind.Reference,
          detail: "Bibliography entry",
          insertText: `${key}}`,
          range: replaceAfter(start, true),
        })) };
      }

      const packageMatch = linePrefix.match(/\\usepackage(?:\[[^\]]*\])?\s*\{([^}]*)$/);
      if (packageMatch) {
        const start = Math.max(linePrefix.lastIndexOf("{"), linePrefix.lastIndexOf(","));
        return { suggestions: PACKAGES.map((name) => ({ label: name, kind: monaco.languages.CompletionItemKind.Module, detail: "LaTeX package", insertText: `${name}}`, range: replaceAfter(start, true) })) };
      }

      const classMatch = linePrefix.match(/\\documentclass(?:\[[^\]]*\])?\s*\{([^}]*)$/);
      if (classMatch) {
        const start = linePrefix.lastIndexOf("{");
        return { suggestions: DOCUMENT_CLASSES.map((name) => ({ label: name, kind: monaco.languages.CompletionItemKind.Class, detail: "Document class", insertText: `${name}}`, range: replaceAfter(start, true) })) };
      }

      const fileMatch = linePrefix.match(/\\(input|include|subfile|includegraphics|bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]*)$/);
      if (fileMatch) {
        const command = fileMatch[1];
        const start = linePrefix.lastIndexOf("{");
        const files = projectFiles.filter((path) => {
          if (command === "includegraphics") return /\.(?:png|jpe?g|pdf|svg|eps)$/i.test(path);
          if (command === "bibliography" || command === "addbibresource") return /\.bib$/i.test(path);
          return /\.(?:tex|sty|cls)$/i.test(path);
        });
        return { suggestions: files.map((path) => {
          const insertPath = command === "input" || command === "include" || command === "subfile" ? path.replace(/\.tex$/i, "") : path;
          return {
            label: path,
            kind: monaco.languages.CompletionItemKind.File,
            detail: "Project file",
            insertText: `${insertPath}}`,
            filterText: path,
            range: replaceAfter(start, true),
          };
        }) };
      }

      const commandMatch = linePrefix.match(/\\[a-zA-Z@]*$/);
      if (!commandMatch) return { suggestions: [] };
      const startColumn = position.column - commandMatch[0].length;
      const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);
      const commandSuggestions = COMMANDS.map((command) => ({
        label: command.label,
        kind: monaco.languages.CompletionItemKind.Function,
        detail: command.detail,
        documentation: { value: `${command.documentation}\n\n\`${command.signature}\`` },
        insertText: command.insert,
        insertTextRules: snippetRule,
        range,
      }));
      const customSuggestions = globalContext.customCommands
        .filter((label) => !COMMANDS.some((command) => command.label === label))
        .map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: "Project-defined command",
          documentation: "This command is defined in the current project.",
          insertText: label,
          range,
        }));
      return { suggestions: [...commandSuggestions, ...customSuggestions] };
    },
  });

  monaco.languages.registerSignatureHelpProvider("latex", {
    signatureHelpTriggerCharacters: ["{", "[", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const match = linePrefix.match(/(\\[a-zA-Z@]+\*?)(?:\[[^\]]*\])?(?:\{[^{}]*\})*\{[^{}]*$/);
      if (!match) return null;
      const command = COMMANDS.find((item) => item.label === match[1].replace(/\*$/, ""));
      if (!command) return null;
      const argumentText = linePrefix.slice((match.index ?? 0) + match[1].length);
      const completedArguments = (argumentText.match(/\}/g) ?? []).length;
      const parameters = [...command.signature.matchAll(/[\[{]([^\]}]+)[\]}]/g)].map((parameter) => ({ label: parameter[1] }));
      return {
        value: {
          signatures: [{ label: command.signature, documentation: command.documentation, parameters }],
          activeSignature: 0,
          activeParameter: Math.min(completedArguments, Math.max(0, parameters.length - 1)),
        },
        dispose: () => undefined,
      };
    },
  });

  monaco.languages.registerHoverProvider("latex", {
    provideHover(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
      const line = model.getLineContent(position.lineNumber);
      const offset = position.column - 1;
      const commandPattern = /\\[a-zA-Z@]+\*?/g;
      let match: RegExpExecArray | null;
      while ((match = commandPattern.exec(line))) {
        if (offset < match.index || offset > match.index + match[0].length) continue;
        const command = COMMANDS.find((item) => item.label === match![0].replace(/\*$/, ""));
        if (!command) return null;
        return {
          range: new monaco.Range(position.lineNumber, match.index + 1, position.lineNumber, match.index + match[0].length + 1),
          contents: [
            { value: `**${command.detail}**` },
            { value: `\`${command.signature}\`` },
            { value: command.documentation },
          ],
        };
      }

      const environmentPattern = /\\(?:begin|end)\s*\{([^}]+)\}/g;
      while ((match = environmentPattern.exec(line))) {
        if (offset < match.index || offset > match.index + match[0].length) continue;
        const environment = ENVIRONMENTS.find((item) => item.name === match![1]);
        if (!environment) return null;
        return { contents: [{ value: `**${environment.name} environment**` }, { value: environment.detail }] };
      }
      return null;
    },
  });
}
