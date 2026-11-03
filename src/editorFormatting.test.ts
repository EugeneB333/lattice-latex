import { describe, expect, it } from "vitest";
import { createFormattingEdit, formatUsesCurrentLine } from "./editorFormatting";

describe("createFormattingEdit", () => {
  it("wraps selected inline text and keeps the content selected", () => {
    expect(createFormattingEdit("bold", "important")).toEqual({
      text: "\\textbf{important}",
      selectionStart: 8,
      selectionEnd: 17,
    });
  });

  it("provides an editable placeholder when there is no selection", () => {
    const edit = createFormattingEdit("italic", "");
    expect(edit.text).toBe("\\textit{italic text}");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("italic text");
  });

  it("turns multiple lines into LaTeX list items", () => {
    expect(createFormattingEdit("bullet-list", "First\nSecond").text).toBe(
      "\\begin{itemize}\n  \\item First\n  \\item Second\n\\end{itemize}",
    );
  });

  it("inserts links while selecting the URL for immediate replacement", () => {
    const edit = createFormattingEdit("link", "OpenAI");
    expect(edit.text).toBe("\\href{https://example.com}{OpenAI}");
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://example.com");
  });

  it("identifies paragraph-level formats", () => {
    expect(formatUsesCurrentLine("section")).toBe(true);
    expect(formatUsesCurrentLine("bullet-list")).toBe(true);
    expect(formatUsesCurrentLine("bold")).toBe(false);
  });

  it("creates all three LaTeX alignment variants", () => {
    expect(createFormattingEdit("left", "Text").text).toBe("\\begin{flushleft}\nText\n\\end{flushleft}");
    expect(createFormattingEdit("center", "Text").text).toBe("\\begin{center}\nText\n\\end{center}");
    expect(createFormattingEdit("right", "Text").text).toBe("\\begin{flushright}\nText\n\\end{flushright}");
  });

  it.each([
    ["underline", "chosen", "\\underline{chosen}"],
    ["monospace", "chosen", "\\texttt{chosen}"],
    ["section", "  Title  ", "\\section{Title}"],
    ["subsection", "  Title  ", "\\subsection{Title}"],
    ["subsubsection", "  Title  ", "\\subsubsection{Title}"],
    ["paragraph", "  Title  ", "\\paragraph{Title}"],
    ["quote", "chosen", "\\begin{quote}\nchosen\n\\end{quote}"],
    ["inline-math", "x+y", "$x+y$"],
  ] as const)("formats %s", (format, selected, expected) => {
    const edit = createFormattingEdit(format, selected);
    expect(edit.text).toBe(expected);
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe(selected.trim());
  });

  it("creates editable placeholders for every block format", () => {
    for (const format of ["section", "subsection", "subsubsection", "paragraph", "quote", "left", "center", "right"] as const) {
      const edit = createFormattingEdit(format, "");
      expect(edit.selectionEnd).toBeGreaterThan(edit.selectionStart);
      expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).not.toBe("");
    }
  });

  it("creates and selects a placeholder list item", () => {
    for (const format of ["bullet-list", "numbered-list"] as const) {
      const edit = createFormattingEdit(format, "");
      expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe("List item");
    }
  });

  it("normalizes CRLF list input and trims individual items", () => {
    expect(createFormattingEdit("numbered-list", " First \r\n Second ").text).toBe(
      "\\begin{enumerate}\n  \\item First\n  \\item Second\n\\end{enumerate}",
    );
  });

  it("classifies every line-oriented format and no inline formats", () => {
    for (const format of ["section", "subsection", "subsubsection", "paragraph", "bullet-list", "numbered-list", "quote", "left", "center", "right"] as const) {
      expect(formatUsesCurrentLine(format), format).toBe(true);
    }
    for (const format of ["bold", "italic", "underline", "monospace", "link", "inline-math"] as const) {
      expect(formatUsesCurrentLine(format), format).toBe(false);
    }
  });
});
