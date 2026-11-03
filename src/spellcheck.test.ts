import { describe, expect, it } from "vitest";
import { maskLatexForSpellcheck } from "./spellcheck";

describe("maskLatexForSpellcheck", () => {
  it("preserves UTF-16 offsets and line breaks", () => {
    const source = "😀 A sentence with $x^2$.\nAnother line.";
    const masked = maskLatexForSpellcheck(source);

    expect(masked).toHaveLength(source.length);
    expect([...masked.matchAll(/\n/g)].map((match) => match.index)).toEqual(
      [...source.matchAll(/\n/g)].map((match) => match.index),
    );
    expect(masked.slice(source.indexOf("Another"))).toBe("Another line.");
  });

  it("keeps visible prose and masks LaTeX commands", () => {
    const source = String.raw`\section{A Beautifull Result}
This is \emph{teh important sentence}.`;
    const masked = maskLatexForSpellcheck(source);

    expect(masked).toContain("A Beautifull Result");
    expect(masked).toContain("teh important sentence");
    expect(masked).not.toContain("section");
    expect(masked).not.toContain("emph");
  });

  it("masks comments, references, paths, URLs, and maths", () => {
    const source = String.raw`Visible prose. % commment teh
See \citep[chap. 2]{smith_2024} and \href{https://example.invalid/a_bad_path}{the website}.
Math $mispelled + x^2$ and \[another_mispelling\].`;
    const masked = maskLatexForSpellcheck(source);

    expect(masked).toContain("Visible prose.");
    expect(masked).toContain("the website");
    expect(masked).not.toContain("commment");
    expect(masked).not.toContain("smith_2024");
    expect(masked).not.toContain("example.invalid");
    expect(masked).not.toContain("mispelled");
    expect(masked).not.toContain("another_mispelling");
  });

  it("masks mathematical and verbatim environments but keeps document prose", () => {
    const source = String.raw`\begin{document}
This sentence remains visible.
\begin{align}
mispelled &= y + z
\end{align}
\begin{verbatim}
another_mispelling
\end{verbatim}
\end{document}`;
    const masked = maskLatexForSpellcheck(source);

    expect(masked).toContain("This sentence remains visible.");
    expect(masked).not.toContain("mispelled");
    expect(masked).not.toContain("another_mispelling");
    expect(masked).not.toContain("document");
    expect(masked).not.toContain("align");
  });

  it("preserves escaped percent signs, dollars, braces, and tildes as text spacing", () => {
    const source = String.raw`Cost is \$5 and 50\% with escaped \{braces\}; prose~continues.`;
    const masked = maskLatexForSpellcheck(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).toContain("Cost is");
    expect(masked).toContain("prose continues");
    expect(masked).not.toContain("% with");
  });

  it("masks display math with every delimiter and tolerates unclosed math", () => {
    for (const source of ["Before $$badword$$ after", String.raw`Before \(badword\) after`, String.raw`Before \[badword\] after`, "Before $badword"]) {
      const masked = maskLatexForSpellcheck(source);
      expect(masked).not.toContain("badword");
      expect(masked).toHaveLength(source.length);
    }
  });

  it("keeps prose arguments but masks nested non-prose command arguments", () => {
    const source = String.raw`\textbf{Visible nested {prose}} cites \citep[see][p. 2]{hidden_key}.`;
    const masked = maskLatexForSpellcheck(source);
    expect(masked).toContain("Visible nested  prose");
    expect(masked).not.toContain("hidden_key");
    expect(masked).not.toContain("p. 2");
  });

  it("masks table column specifications but keeps cell prose", () => {
    const source = String.raw`\begin{tabular}[t]{lcr}First cell & second cell\\\end{tabular}`;
    const masked = maskLatexForSpellcheck(source);
    expect(masked).not.toContain("lcr");
    expect(masked).toContain("First cell & second cell");
  });

  it("masks starred and unclosed verbatim environments to the end", () => {
    const source = String.raw`Before \begin{verbatim*}badword without an end`;
    const masked = maskLatexForSpellcheck(source);
    expect(masked).toContain("Before");
    expect(masked).not.toContain("badword");
    expect(masked).toHaveLength(source.length);
  });

  it("preserves all newline styles while masking multiline syntax", () => {
    const source = "Visible\r\n% hidden\r\nMore $math$";
    const masked = maskLatexForSpellcheck(source);
    expect([...masked.matchAll(/\r\n/g)]).toHaveLength(2);
    expect(masked).toContain("Visible");
    expect(masked).toContain("More");
  });
});
