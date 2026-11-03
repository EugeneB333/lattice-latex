import { describe, expect, it } from "vitest";
import { generateLatexTable, type LatexTableOptions } from "./latexTable";
import { parseLatexTableAt } from "./latexTableParser";

function parseGenerated(options: LatexTableOptions, needle: string) {
  const latex = generateLatexTable(options);
  const source = `Before\n${latex}\nAfter`;
  const result = parseLatexTableAt(source, source.indexOf(needle));
  expect(result.error).toBeUndefined();
  return { latex, source, table: result.table! };
}

describe("graphical LaTeX table parsing", () => {
  it("round-trips a rich floating table and its metadata", () => {
    const { latex, source, table } = parseGenerated({
      rows: [["Item", "Price"], ["A&B", "$2"]],
      alignments: ["l", "r"],
      cellStyles: [[{}, {}], [{ italic: true, backgroundColor: "#fff2cc", textColor: "#c00000", alignment: "c" }, {}]],
      hasHeader: true,
      boldFirstColumn: true,
      ruleStyle: "booktabs",
      position: "center",
      floating: true,
      placement: "t",
      caption: "Costs & revenue",
      captionPosition: "above",
      label: "tab:costs",
    }, "A\\&B");
    expect(source.slice(table.startOffset, table.endOffset)).toBe(latex);
    expect(table.options).toMatchObject({
      rows: [["Item", "Price"], ["A&B", "$2"]], alignments: ["l", "r"], hasHeader: true,
      boldFirstColumn: true, ruleStyle: "booktabs", verticalRules: "none", position: "center",
      floating: true, placement: "t", caption: "Costs & revenue", captionPosition: "above", label: "tab:costs",
    });
    expect(table.options.cellStyles?.[1][0]).toMatchObject({ italic: true, backgroundColor: "FFF2CC", textColor: "C00000", alignment: "c" });
  });

  it("parses standalone wrappers, typography, spacing, coloured rules, and banded rows", () => {
    const { latex, source, table } = parseGenerated({
      rows: [["A", "1"], ["B", "2"], ["C", "3"]], alignments: ["l", "r"],
      ruleStyle: "grid", verticalRules: "all", position: "right", fontSize: "small",
      rowSpacing: "relaxed", stripedRows: true, stripeColor: "#ddebf7", ruleColor: "#4472c4",
    }, "B & 2");
    expect(source.slice(table.startOffset, table.endOffset)).toBe(latex);
    expect(table.options).toMatchObject({
      rows: [["A", "1"], ["B", "2"], ["C", "3"]], ruleStyle: "grid", verticalRules: "all",
      position: "right", fontSize: "small", rowSpacing: "relaxed", stripedRows: true,
      stripeColor: "#DDEBF7", ruleColor: "#4472C4",
    });
  });

  it("distinguishes outer and header horizontal rules in simple tables", () => {
    const outer = String.raw`\begin{tabular}{|lr|}
\hline
A & 1 \\
B & 2 \\
\hline
\end{tabular}`;
    expect(parseLatexTableAt(outer, outer.indexOf("B &" )).table?.options).toMatchObject({ ruleStyle: "outer", verticalRules: "outer", hasHeader: false });
    const header = String.raw`\begin{tabular}{lr}
\hline
Name & Count \\
\hline
Ada & 4 \\
Lin & 8 \\
\hline
\end{tabular}`;
    expect(parseLatexTableAt(header, header.indexOf("Ada")).table?.options).toMatchObject({ ruleStyle: "standard", hasHeader: true, boldHeader: false });
  });

  it("finds a tabular table from its surrounding float or caption", () => {
    const latex = generateLatexTable({ rows: [["A"]], floating: true, caption: "Summary" });
    expect(parseLatexTableAt(latex, latex.indexOf("Summary")).table?.options.caption).toBe("Summary");
  });

  it("ignores commented-out environments and comments between table rows", () => {
    const source = String.raw`% \begin{tabular}{l}
% Fake \\
% \end{tabular}
\begin{tabular}{l}
A \\ % row note
B \\
\end{tabular}`;
    expect(parseLatexTableAt(source, source.indexOf("Fake")).error).toContain("No editable table");
    expect(parseLatexTableAt(source, source.indexOf("B ")).table?.options.rows).toEqual([["A"], ["B"]]);
  });

  it.each([
    ["outside", "Plain prose", 2, "No editable table"],
    ["custom columns", "\\begin{tabular}{p{3cm}}\nA \\\\n\\end{tabular}", 25, "cannot safely preserve"],
    ["merged cells", "\\begin{tabular}{ll}\n\\multicolumn{2}{c}{A} & B \\\\n\\end{tabular}", 35, "cannot safely preserve"],
    ["raw cell commands", "\\begin{tabular}{l}\n\\emph{A} \\\\n\\end{tabular}", 27, "cannot safely preserve"],
  ])("rejects %s without rewriting it", (_name, source, offset, message) => {
    expect(parseLatexTableAt(source, offset).error).toContain(message);
  });
});
