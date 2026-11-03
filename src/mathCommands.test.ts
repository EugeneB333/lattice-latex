import { describe, expect, it } from "vitest";
import {
  ACCENT_COMMANDS,
  GREEK_COMMANDS,
  mathSnippet,
  SPECIAL_COMMANDS,
  STRUCTURE_COMMANDS,
  SYMBOL_COMMANDS,
  type MathCommandId,
} from "./mathCommands";

describe("math toolbar snippets", () => {
  it("wraps selected text in inline mathematics", () => {
    expect(mathSnippet("inline", "x+y")).toBe("\\$${1:x+y}\\$");
  });

  it("creates tab stops for both fraction arguments", () => {
    expect(mathSnippet("fraction")).toBe("\\frac{${1:numerator}}{${2:denominator}}");
  });

  it("escapes snippet metacharacters in selected LaTeX", () => {
    expect(mathSnippet("sqrt", "\\alpha_$value}")).toBe("\\sqrt{${1:\\\\alpha_\\$value\\}}}");
  });

  it("inserts complete multi-line structures", () => {
    const snippet = mathSnippet("pmatrix");
    expect(snippet).toContain("\\begin{pmatrix}");
    expect(snippet).toContain("${4:d}");
    expect(snippet).toContain("\\end{pmatrix}");
  });

  it("offers every lowercase and capital Greek letter", () => {
    expect(GREEK_COMMANDS).toHaveLength(55);
    expect(GREEK_COMMANDS.filter((command) => command.title.startsWith("Lowercase"))).toHaveLength(24);
    expect(GREEK_COMMANDS.filter((command) => command.title.startsWith("Capital"))).toHaveLength(24);
  });

  it("includes the standard alternate Greek forms", () => {
    const variants = GREEK_COMMANDS.filter((command) => command.group === "Variant forms");
    expect(variants.map((command) => command.id)).toEqual([
      "varepsilon", "vartheta", "varkappa", "varpi", "varrho", "varsigma", "varphi",
    ]);
    expect(mathSnippet("vartheta")).toBe("\\vartheta ");
    expect(mathSnippet("varphi")).toBe("\\varphi ");
  });

  it("includes grouped special and physical symbols", () => {
    expect(SPECIAL_COMMANDS.map((command) => command.id)).toContain("hbar");
    expect(SPECIAL_COMMANDS.map((command) => command.id)).toContain("nabla");
    expect(SPECIAL_COMMANDS.map((command) => command.id)).toContain("degree");
    expect(mathSnippet("hbar")).toBe("\\hbar ");
    expect(mathSnippet("degree")).toBe("^{\\circ} ");
  });

  it("maps every menu option to defined LaTeX", () => {
    for (const command of [...GREEK_COMMANDS, ...SPECIAL_COMMANDS, ...ACCENT_COMMANDS, ...SYMBOL_COMMANDS, ...STRUCTURE_COMMANDS]) {
      expect(mathSnippet(command.id), command.id).not.toContain("undefined");
    }
  });

  it("does not repeat commands across dropdown menus", () => {
    const ids = [...GREEK_COMMANDS, ...SPECIAL_COMMANDS, ...ACCENT_COMMANDS, ...SYMBOL_COMMANDS, ...STRUCTURE_COMMANDS]
      .map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("wraps selections in vector and accent templates", () => {
    expect(mathSnippet("vec", "F")).toBe("\\vec{${1:F}}");
    expect(mathSnippet("widetilde", "ABC")).toBe("\\widetilde{${1:ABC}}");
    expect(mathSnippet("overline")).toBe("\\overline{${1:AB}}");
  });

  it("rejects an unknown runtime command instead of inserting undefined", () => {
    expect(() => mathSnippet("not-a-command" as MathCommandId)).toThrow("Unknown maths command");
  });

  it("uses standard LaTeX notation for Greek capitals", () => {
    expect(mathSnippet("Gamma")).toBe("\\Gamma ");
    expect(mathSnippet("Alpha")).toBe("A ");
    expect(mathSnippet("omicron")).toBe("o ");
  });
});
