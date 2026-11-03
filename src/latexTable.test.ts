// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  clipboardTableToLatex,
  createEmptyTable,
  escapeLatexTableCell,
  generateLatexTable,
  getLatexTablePackages,
  handleSmartTablePaste,
  inferTableAlignments,
  normalizeLatexLabel,
  parseClipboardTable,
  parseDelimitedTable,
  pasteTableCells,
} from "./latexTable";

describe("spreadsheet clipboard parsing", () => {
  it("parses rectangular TSV, CRLF, empty cells, quoted tabs, quotes, and line breaks", () => {
    expect(parseDelimitedTable('Name\tNote\r\nAda\t"one\tpart"\r\nLin\t"two\nlines"\r\n')).toEqual([
      ["Name", "Note"],
      ["Ada", "one\tpart"],
      ["Lin", "two\nlines"],
    ]);
    expect(parseDelimitedTable('"A ""quote"""\t\n')).toEqual([["A \"quote\"", ""]]);
  });

  it("prefers HTML tables, decodes text, expands column spans, and recognizes headings", () => {
    const parsed = parseClipboardTable({
      html: "<table><thead><tr><th>Item &amp; kind</th><th colspan='2'>Totals</th></tr></thead><tbody><tr><td>Apples</td><td>2</td><td>3.50</td></tr></tbody></table>",
      text: "ignored\ttext\nignored\ttext",
    });
    expect(parsed).toEqual({
      rows: [["Item & kind", "Totals", ""], ["Apples", "2", "3.50"]],
      hasHeader: true,
      alignments: ["l", "r", "r"],
      cellStyles: [[{}, {}, {}], [{}, {}, {}]],
    });
  });

  it("imports common spreadsheet cell formatting from rich HTML", () => {
    const parsed = parseClipboardTable({
      html: `<table><tr><td style="background-color: rgb(255, 242, 204); color: #c00000; font-weight: 700; font-style: italic; text-decoration: underline; text-align: center">Total</td><td bgcolor="#DDEBF7" align="right">4</td></tr></table>`,
    });
    expect(parsed?.cellStyles).toEqual([[
      { bold: true, italic: true, underline: true, backgroundColor: "FFF2CC", textColor: "C00000", alignment: "c" },
      { backgroundColor: "DDEBF7", alignment: "r" },
    ]]);
  });

  it("accepts only unambiguous TSV as the plain-text fallback", () => {
    expect(parseClipboardTable({ text: "A\tB\n1\t2" })?.rows).toEqual([["A", "B"], ["1", "2"]]);
    expect(parseClipboardTable({ text: "A\tB" })).toBeUndefined();
    expect(parseClipboardTable({ text: "ordinary\nparagraph" })).toBeUndefined();
    expect(parseClipboardTable({ html: "<p>not a table</p>", text: "plain" })).toBeUndefined();
    expect(parseClipboardTable({ text: "" })).toBeUndefined();
  });

  it("consumes smart table paste exactly once and leaves ordinary or unavailable clipboard data alone", () => {
    const insert = vi.fn();
    const spreadsheet = {
      clipboardData: { getData: (format: string) => format === "text/plain" ? "Name\tCount\nAda\t2" : "" },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(handleSmartTablePaste(spreadsheet, insert)).toBe(true);
    expect(spreadsheet.preventDefault).toHaveBeenCalledOnce();
    expect(spreadsheet.stopPropagation).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0][0]).toContain("\\begin{tabular}{lr}");

    const ordinary = {
      clipboardData: { getData: (format: string) => format === "text/plain" ? "ordinary text" : "" },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(handleSmartTablePaste(ordinary, insert)).toBe(false);
    expect(handleSmartTablePaste({ ...ordinary, clipboardData: null }, insert)).toBe(false);
    expect(ordinary.preventDefault).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledOnce();
  });

  it("infers numeric columns while treating blanks and mixed values as text", () => {
    expect(inferTableAlignments([["Item", "Price", "Mixed"], ["A", "£1,200.50", "2"], ["B", "(3.5)", "n/a"]], true)).toEqual(["l", "r", "l"]);
  });
});

describe("LaTeX table generation", () => {
  it("escapes every LaTeX-special character without double escaping", () => {
    expect(escapeLatexTableCell(String.raw`a&b%$#_{}~^\c`)).toBe(String.raw`a\&b\%\$\#\_\{\}\textasciitilde{}\textasciicircum{}\textbackslash{}c`);
    expect(normalizeLatexLabel(" tab:revenue_1 & costs ")).toBe("tab:revenue_1-costs");
  });

  it("generates a standard standalone table with heading and alignment rules", () => {
    expect(generateLatexTable({
      rows: [["Item", "Price"], ["A&B", "$2"]],
      alignments: ["l", "r"],
      hasHeader: true,
    })).toBe(String.raw`\begin{tabular}{lr}
  \hline
  \textbf{Item} & \textbf{Price} \\
  \hline
  A\&B & \$2 \\
  \hline
\end{tabular}`);
  });

  it("can keep a semantic header rule without forcing bold header text", () => {
    const output = generateLatexTable({ rows: [["Name"], ["Ada"]], hasHeader: true, boldHeader: false });
    expect(output.match(/\\hline/g)).toHaveLength(3);
    expect(output).toContain(String.raw`  Name \\`);
    expect(output).not.toContain("\\textbf{Name}");
  });

  it("supports no rules and a floating booktabs table with escaped metadata", () => {
    expect(generateLatexTable({ rows: [["A"]], ruleStyle: "none" })).toBe("\\begin{tabular}{l}\n  A \\\\\n\\end{tabular}");
    const output = generateLatexTable({
      rows: [["A", "1"]], alignments: ["c", "r"], ruleStyle: "booktabs", floating: true,
      caption: "Revenue & costs", label: "tab:revenue_1",
    });
    expect(output).toContain("\\begin{table}[htbp]\n  \\centering");
    expect(output).toContain("    \\toprule");
    expect(output).toContain("  \\caption{Revenue \\& costs}");
    expect(output).toContain("  \\label{tab:revenue_1}");
    expect(output).toContain("\\end{table}");
  });

  it("generates grid and vertical rules with optional first-column emphasis", () => {
    const output = generateLatexTable({
      rows: [["Item", "Value"], ["Apples", "4"]],
      alignments: ["l", "r"],
      hasHeader: true,
      boldFirstColumn: true,
      ruleStyle: "grid",
      verticalRules: "all",
    });
    expect(output).toContain("\\begin{tabular}{|l|r|}");
    expect(output).toContain("\\textbf{Item} & \\textbf{Value}");
    expect(output).toContain("\\textbf{Apples} & 4");
    expect(output).not.toContain("\\textbf{\\textbf{");
    expect(output.match(/\\hline/g)).toHaveLength(3);
    expect(generateLatexTable({ rows: [["A", "B"]], verticalRules: "outer" })).toContain("\\begin{tabular}{|ll|}");
  });

  it("offers a distinct outer-only horizontal border", () => {
    const outer = generateLatexTable({ rows: [["Header"], ["Body"]], hasHeader: true, ruleStyle: "outer" });
    expect(outer.match(/\\hline/g)).toHaveLength(2);
    expect(outer).toContain("\\textbf{Header} \\\\\n  Body");
    const header = generateLatexTable({ rows: [["Header"], ["Body"]], hasHeader: true, ruleStyle: "standard" });
    expect(header.match(/\\hline/g)).toHaveLength(3);
  });

  it("wraps standalone tables for alignment, typography, and every row-spacing preset", () => {
    for (const [rowSpacing, factor] of [["compact", "0.85"], ["relaxed", "1.25"], ["spacious", "1.5"]] as const) {
      const output = generateLatexTable({
        rows: [["A"]], position: "center", fontSize: "footnotesize", rowSpacing, ruleStyle: "none",
      });
      expect(output).toContain("\\begin{center}\n  \\begingroup\n    \\footnotesize");
      expect(output).toContain(`\\renewcommand{\\arraystretch}{${factor}}`);
      expect(output).toContain("\\endgroup\n\\end{center}");
    }
    expect(generateLatexTable({ rows: [["A"]], position: "right", fontSize: "small" })).toContain("\\begin{flushright}");
  });

  it("supports every float placement, table alignment, and captions above or below", () => {
    for (const placement of ["htbp", "h", "t", "b", "p"] as const) {
      expect(generateLatexTable({ rows: [["A"]], floating: true, placement })).toContain(`\\begin{table}[${placement}]`);
    }
    const above = generateLatexTable({
      rows: [["A"]], floating: true, position: "right", caption: "Above", label: "tab:above", captionPosition: "above",
    });
    expect(above.indexOf("\\raggedleft")).toBeLessThan(above.indexOf("\\caption{Above}"));
    expect(above.indexOf("\\caption{Above}")).toBeLessThan(above.indexOf("\\begin{tabular}"));
    expect(above).toContain("\\caption{Above}\n  \\label{tab:above}");
    const below = generateLatexTable({ rows: [["A"]], floating: true, position: "left", caption: "Below" });
    expect(below).toContain("\\raggedright");
    expect(below.indexOf("\\caption{Below}")).toBeGreaterThan(below.indexOf("\\end{tabular}"));
  });

  it("omits vertical rules from booktabs output", () => {
    const output = generateLatexTable({ rows: [["A", "B"]], ruleStyle: "booktabs", verticalRules: "all" });
    expect(output).toContain("\\begin{tabular}{ll}");
    expect(output).not.toContain("{|l|l|}");
  });

  it("formats individual cells with colours, emphasis, and alignment while preserving grid borders", () => {
    const output = generateLatexTable({
      rows: [["Total", "4"], ["Notes", "ok"]],
      alignments: ["l", "r"],
      verticalRules: "all",
      cellStyles: [[
        { bold: true, italic: true, underline: true, backgroundColor: "#fff2cc", textColor: "#c00000", alignment: "c" },
        {},
      ], [{}, {}]],
    });
    expect(output).toContain(String.raw`\multicolumn{1}{|c|}{\cellcolor[HTML]{FFF2CC}\textcolor[HTML]{C00000}{\textbf{\textit{\underline{Total}}}}}`);
    expect(output).not.toContain("\\textbf{\\textbf{");
    expect(getLatexTablePackages({ rows: [["A"]], cellStyles: [[{ backgroundColor: "#ffffff" }]] })).toEqual(["\\usepackage[table]{xcolor}"]);
  });

  it("supports banded rows and scoped coloured rules", () => {
    const output = generateLatexTable({
      rows: [["Header"], ["First"], ["Second"], ["Third"]], hasHeader: true,
      stripedRows: true, stripeColor: "#ddebf7", ruleColor: "#4472c4",
    });
    expect(output).toContain("\\begingroup\n  \\arrayrulecolor[HTML]{4472C4}");
    expect(output.match(/\\rowcolor\[HTML\]\{DDEBF7\}/g)).toHaveLength(1);
    expect(output.indexOf("\\rowcolor[HTML]{DDEBF7}")).toBeGreaterThan(output.indexOf("First"));
    expect(getLatexTablePackages({ rows: [["A"]], stripedRows: true, ruleStyle: "booktabs" })).toEqual([
      "\\usepackage[table]{xcolor}", "\\usepackage{booktabs}",
    ]);
  });

  it("converts clipboard data with inferred alignment", () => {
    expect(clipboardTableToLatex({ text: "Name\tCount\nAda\t4" })).toContain("\\begin{tabular}{lr}");
    expect(clipboardTableToLatex({
      html: '<table><tr><td style="background-color:#fff2cc">A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
    })).not.toContain("\\cellcolor");
  });

  it("creates bounded empty grids and pastes while expanding in either dimension", () => {
    expect(createEmptyTable(0, 0)).toEqual([[""]]);
    expect(createEmptyTable(2, 2)).toEqual([["", ""], ["", ""]]);
    expect(pasteTableCells([["A"]], [["B", "C"], ["D", "E"]], 1, 1)).toEqual([
      ["A", "", ""], ["", "B", "C"], ["", "D", "E"],
    ]);
  });
});
