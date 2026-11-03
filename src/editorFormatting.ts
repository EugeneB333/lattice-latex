export type EditorFormat =
  | "bold"
  | "italic"
  | "underline"
  | "monospace"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "bullet-list"
  | "numbered-list"
  | "quote"
  | "link"
  | "inline-math"
  | "left"
  | "right"
  | "center";

export type FormattingEdit = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

const CURRENT_LINE_FORMATS = new Set<EditorFormat>([
  "section", "subsection", "subsubsection", "paragraph",
  "bullet-list", "numbered-list", "quote", "left", "center", "right",
]);

export function formatUsesCurrentLine(format: EditorFormat) {
  return CURRENT_LINE_FORMATS.has(format);
}

function wrap(prefix: string, selectedText: string, suffix: string, placeholder: string): FormattingEdit {
  const content = selectedText || placeholder;
  return {
    text: `${prefix}${content}${suffix}`,
    selectionStart: prefix.length,
    selectionEnd: prefix.length + content.length,
  };
}

function list(environment: "itemize" | "enumerate", selectedText: string): FormattingEdit {
  const content = selectedText
    ? selectedText.split(/\r?\n/).map((line) => `  \\item ${line.trim()}`).join("\n")
    : "  \\item List item";
  const prefix = `\\begin{${environment}}\n`;
  const text = `${prefix}${content}\n\\end{${environment}}`;
  const placeholderStart = selectedText ? prefix.length : prefix.length + "  \\item ".length;
  return {
    text,
    selectionStart: placeholderStart,
    selectionEnd: selectedText ? prefix.length + content.length : placeholderStart + "List item".length,
  };
}

export function createFormattingEdit(format: EditorFormat, selectedText: string): FormattingEdit {
  switch (format) {
    case "bold": return wrap("\\textbf{", selectedText, "}", "bold text");
    case "italic": return wrap("\\textit{", selectedText, "}", "italic text");
    case "underline": return wrap("\\underline{", selectedText, "}", "underlined text");
    case "monospace": return wrap("\\texttt{", selectedText, "}", "monospace text");
    case "section": return wrap("\\section{", selectedText.trim(), "}", "Section title");
    case "subsection": return wrap("\\subsection{", selectedText.trim(), "}", "Subsection title");
    case "subsubsection": return wrap("\\subsubsection{", selectedText.trim(), "}", "Subsubsection title");
    case "paragraph": return wrap("\\paragraph{", selectedText.trim(), "}", "Paragraph title");
    case "bullet-list": return list("itemize", selectedText);
    case "numbered-list": return list("enumerate", selectedText);
    case "quote": return wrap("\\begin{quote}\n", selectedText, "\n\\end{quote}", "Quoted text");
    case "inline-math": return wrap("$", selectedText, "$", "x");
    case "left": return wrap("\\begin{flushleft}\n", selectedText, "\n\\end{flushleft}", "Left-aligned text");
    case "center": return wrap("\\begin{center}\n", selectedText, "\n\\end{center}", "Centred text");
    case "right": return wrap("\\begin{flushright}\n", selectedText, "\n\\end{flushright}", "Right-aligned text");
    case "link": {
      const url = "https://example.com";
      const text = `\\href{${url}}{${selectedText || "link text"}}`;
      return { text, selectionStart: "\\href{".length, selectionEnd: "\\href{".length + url.length };
    }
  }
}
