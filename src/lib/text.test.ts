import { describe, expect, it } from "vitest";
import { basename, diffLines, parseLatexOutline, replaceSelection } from "./text";

describe("text helpers", () => {
  it("replaces a line selection without disturbing surrounding source", () => {
    const source = "one\ntwo\nthree\nfour";
    expect(
      replaceSelection(source, { startLine: 2, startColumn: 1, endLine: 3, endColumn: 6, text: "two\nthree" }, "changed"),
    ).toBe("one\nchanged\nfour");
  });

  it("preserves text outside a partial selection", () => {
    expect(replaceSelection(
      "Before strong claim after",
      { startLine: 1, startColumn: 8, endLine: 1, endColumn: 20, text: "strong claim" },
      "measured result",
    )).toBe("Before measured result after");
  });

  it("finds a portable basename", () => {
    expect(basename("chapters/results.tex")).toBe("results.tex");
  });

  it("builds a navigable outline from LaTeX section commands", () => {
    expect(parseLatexOutline([
      "\\section{Introduction}",
      "Text",
      "  \\subsection[Short title]{Method}",
      "\\subsubsection*{Details}",
      "\\paragraph{Observation}",
    ].join("\n"))).toEqual([
      { command: "section", title: "Introduction", line: 1, depth: 0 },
      { command: "subsection", title: "Method", line: 3, depth: 1 },
      { command: "subsubsection", title: "Details", line: 4, depth: 2 },
      { command: "paragraph", title: "Observation", line: 5, depth: 3 },
    ]);
  });

  it("ignores commented section commands", () => {
    expect(parseLatexOutline("% \\section{Hidden}\n\\section{Visible}"))
      .toEqual([{ command: "section", title: "Visible", line: 2, depth: 0 }]);
  });

  it("replaces the whole document when no selection exists", () => {
    expect(replaceSelection("old", undefined, "new")).toBe("new");
  });

  it("handles insertions at line boundaries and out-of-range coordinates safely", () => {
    expect(replaceSelection("abc\ndef", { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, text: "" }, "X")).toBe("Xabc\ndef");
    expect(replaceSelection("abc", { startLine: 9, startColumn: 1, endLine: 9, endColumn: 1, text: "" }, "X")).toBe("abc\nX");
  });

  it("diffs unchanged, replaced, added, removed, and empty lines", () => {
    expect(diffLines("same", "same")).toEqual([{ type: "same", text: "same" }]);
    expect(diffLines("a\nb", "a\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "c" },
      { type: "add", text: "d" },
    ]);
    expect(diffLines("a\n", "a")).toEqual([{ type: "same", text: "a" }, { type: "remove", text: "" }]);
  });

  it("handles portable basename edge cases", () => {
    expect(basename("main.tex")).toBe("main.tex");
    expect(basename("folder/")).toBe("");
    expect(basename("")).toBe("");
  });

  it("covers every outline depth, starred forms, optional titles, and untitled headings", () => {
    expect(parseLatexOutline([
      "\\part{P}", "\\chapter{C}", "\\section*{S}", "\\subsection[short]{Sub}",
      "\\subsubsection{Deep}", "\\paragraph{}", "\\subparagraph{Lowest}",
    ].join("\n"))).toEqual([
      { command: "part", title: "P", line: 1, depth: 0 },
      { command: "chapter", title: "C", line: 2, depth: 0 },
      { command: "section", title: "S", line: 3, depth: 0 },
      { command: "subsection", title: "Sub", line: 4, depth: 1 },
      { command: "subsubsection", title: "Deep", line: 5, depth: 2 },
      { command: "paragraph", title: "Untitled", line: 6, depth: 3 },
      { command: "subparagraph", title: "Lowest", line: 7, depth: 4 },
    ]);
  });

  it("ignores inline, malformed, and unsupported section-like commands", () => {
    expect(parseLatexOutline("Text \\section{Inline}\n\\section Missing\n\\title{Nope}")).toEqual([]);
  });
});
