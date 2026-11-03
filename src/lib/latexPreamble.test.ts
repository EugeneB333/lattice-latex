import { describe, expect, it } from "vitest";
import { createLatexPreambleInsertion } from "./latexPreamble";

function apply(source: string, required: string[]) {
  const insertion = createLatexPreambleInsertion(source, required);
  return insertion ? `${source.slice(0, insertion.offset)}${insertion.text}${source.slice(insertion.offset)}` : source;
}

describe("automatic LaTeX package insertion", () => {
  it("adds required packages after the existing preamble packages", () => {
    const source = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHello\n\\end{document}";
    const insertion = createLatexPreambleInsertion(source, ["\\usepackage[table]{xcolor}", "\\usepackage{booktabs}"]);
    expect(insertion?.addedPackages).toEqual(["xcolor", "booktabs"]);
    expect(apply(source, ["\\usepackage[table]{xcolor}", "\\usepackage{booktabs}"])).toContain(
      "\\usepackage{amsmath}\n\\usepackage[table]{xcolor}\n\\usepackage{booktabs}\n\\begin{document}",
    );
  });

  it("does not duplicate packages already loaded alone or in a package list", () => {
    const source = "\\documentclass{article}\n\\usepackage[table,dvipsnames]{xcolor}\n\\usepackage{amsmath,booktabs}\n\\begin{document}";
    expect(createLatexPreambleInsertion(source, ["\\usepackage[table]{xcolor}", "\\usepackage{booktabs}"])).toBeUndefined();
  });

  it("adds colortbl when xcolor is already loaded without table support", () => {
    const source = "\\documentclass{article}\n\\usepackage{xcolor}\n\\begin{document}";
    const insertion = createLatexPreambleInsertion(source, ["\\usepackage[table]{xcolor}"]);
    expect(insertion?.addedPackages).toEqual(["colortbl"]);
    expect(apply(source, ["\\usepackage[table]{xcolor}"])).toContain("\\usepackage{xcolor}\n\\usepackage{colortbl}\n");
  });

  it("loads xcolor before an existing colortbl declaration", () => {
    const source = "\\documentclass{article}\n\\usepackage{colortbl}\n\\begin{document}";
    expect(apply(source, ["\\usepackage[table]{xcolor}"])).toContain("\\usepackage{xcolor}\n\\usepackage{colortbl}\n");
  });

  it("ignores commented package declarations and inserts after documentclass when no active package exists", () => {
    const source = "% \\usepackage{booktabs}\n\\documentclass{article}\n\\begin{document}";
    const result = apply(source, ["\\usepackage{booktabs}"]);
    expect(result).toContain("\\documentclass{article}\n\\usepackage{booktabs}\n\\begin{document}");
    expect(result.match(/^[^%\n]*\\usepackage\{booktabs\}/gm)).toHaveLength(1);
  });

  it("supports preamble fragments without a documentclass and ignores escaped percent signs", () => {
    const source = "Price \\% note\n\\usepackage{amsmath}\n";
    expect(apply(source, ["\\usepackage{booktabs}"])).toBe("Price \\% note\n\\usepackage{amsmath}\n\\usepackage{booktabs}\n");
    expect(createLatexPreambleInsertion(source, [])).toBeUndefined();
  });
});
