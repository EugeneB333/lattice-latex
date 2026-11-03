export type MathCommandId =
  | "inline" | "display" | "fraction" | "sqrt" | "nth-root" | "superscript" | "subscript"
  | "parentheses" | "brackets" | "absolute" | "sum" | "product" | "integral" | "limit"
  | "derivative" | "partial-derivative" | "alpha" | "beta" | "gamma" | "delta" | "epsilon"
  | "zeta" | "eta" | "theta" | "iota" | "kappa" | "lambda" | "mu" | "nu" | "xi" | "omicron"
  | "pi" | "rho" | "sigma" | "tau" | "upsilon" | "phi" | "chi" | "psi" | "omega"
  | "varepsilon" | "vartheta" | "varkappa" | "varpi" | "varrho" | "varsigma" | "varphi"
  | "Alpha" | "Beta" | "Gamma" | "Delta" | "Epsilon" | "Zeta" | "Eta" | "Theta" | "Iota"
  | "Kappa" | "Lambda" | "Mu" | "Nu" | "Xi" | "Omicron" | "Pi" | "Rho" | "Sigma" | "Tau"
  | "Upsilon" | "Phi" | "Chi" | "Psi" | "Omega"
  | "leq" | "geq" | "neq" | "approx" | "in" | "notin" | "subset" | "to" | "mapsto"
  | "infty" | "cdot" | "times" | "pm" | "align" | "pmatrix" | "bmatrix" | "cases"
  | "planck" | "hbar" | "euler" | "imaginary" | "differential" | "nabla" | "partial"
  | "ell" | "real-part" | "imaginary-part" | "emptyset" | "forall" | "exists" | "propto"
  | "angle" | "perp" | "parallel" | "degree" | "prime" | "dagger" | "ddagger" | "aleph"
  | "weierstrass" | "therefore" | "because"
  | "vec" | "overrightarrow" | "overleftarrow" | "hat" | "widehat" | "tilde" | "widetilde"
  | "bar" | "overline" | "underline-math" | "dot" | "ddot" | "breve" | "check" | "acute"
  | "grave" | "mathring" | "mathbf" | "boldsymbol";

export interface MathCommandOption {
  id: MathCommandId;
  label: string;
  title: string;
  group?: string;
}

const field = (index: number, fallback: string) => `\${${index}:${fallback.replace(/[\\$}]/g, "\\$&")}}`;
const chosen = (selection: string, fallback: string) => selection || fallback;

export function mathSnippet(command: MathCommandId, selection = ""): string {
  const value = (index: number, fallback: string) => field(index, chosen(selection, fallback));
  switch (command) {
    case "inline": return `\\$${value(1, "x")}\\$`;
    case "display": return `\\[\n  ${value(1, "x")}\n\\]`;
    case "fraction": return `\\frac{${value(1, "numerator")}}{${field(2, "denominator")}}`;
    case "sqrt": return `\\sqrt{${value(1, "x")}}`;
    case "nth-root": return `\\sqrt[${field(1, "n")}]{${field(2, chosen(selection, "x"))}}`;
    case "superscript": return `${value(1, "x")}^{${field(2, "n")}}`;
    case "subscript": return `${value(1, "x")}_{${field(2, "i")}}`;
    case "parentheses": return `\\left(${value(1, "x")}\\right)`;
    case "brackets": return `\\left[${value(1, "x")}\\right]`;
    case "absolute": return `\\left|${value(1, "x")}\\right|`;
    case "sum": return `\\sum_{${field(1, "i=1")}}^{${field(2, "n")}} ${field(3, chosen(selection, "a_i"))}`;
    case "product": return `\\prod_{${field(1, "i=1")}}^{${field(2, "n")}} ${field(3, chosen(selection, "a_i"))}`;
    case "integral": return `\\int_{${field(1, "a")}}^{${field(2, "b")}} ${field(3, chosen(selection, "f(x)"))}\\,\\mathrm{d}${field(4, "x")}`;
    case "limit": return `\\lim_{${field(1, "x \\to a")}} ${field(2, chosen(selection, "f(x)"))}`;
    case "derivative": return `\\frac{\\mathrm{d}${field(1, chosen(selection, "y"))}}{\\mathrm{d}${field(2, "x")}}`;
    case "partial-derivative": return `\\frac{\\partial ${field(1, chosen(selection, "f"))}}{\\partial ${field(2, "x")}}`;
    case "vec": return `\\vec{${value(1, "v")}}`;
    case "overrightarrow": return `\\overrightarrow{${value(1, "AB")}}`;
    case "overleftarrow": return `\\overleftarrow{${value(1, "AB")}}`;
    case "hat": return `\\hat{${value(1, "x")}}`;
    case "widehat": return `\\widehat{${value(1, "ABC")}}`;
    case "tilde": return `\\tilde{${value(1, "x")}}`;
    case "widetilde": return `\\widetilde{${value(1, "ABC")}}`;
    case "bar": return `\\bar{${value(1, "x")}}`;
    case "overline": return `\\overline{${value(1, "AB")}}`;
    case "underline-math": return `\\underline{${value(1, "x")}}`;
    case "dot": return `\\dot{${value(1, "x")}}`;
    case "ddot": return `\\ddot{${value(1, "x")}}`;
    case "breve": return `\\breve{${value(1, "x")}}`;
    case "check": return `\\check{${value(1, "x")}}`;
    case "acute": return `\\acute{${value(1, "x")}}`;
    case "grave": return `\\grave{${value(1, "x")}}`;
    case "mathring": return `\\mathring{${value(1, "x")}}`;
    case "mathbf": return `\\mathbf{${value(1, "v")}}`;
    case "boldsymbol": return `\\boldsymbol{${value(1, "v")}}`;
    case "align": return `\\begin{align}\n  ${field(1, chosen(selection, "f(x)"))} &= ${field(2, "g(x)")} \\\\\n  ${field(3, "h(x)")} &= ${field(4, "k(x)")}\n\\end{align}`;
    case "pmatrix": return `\\begin{pmatrix}\n  ${field(1, "a")} & ${field(2, "b")} \\\\\n  ${field(3, "c")} & ${field(4, "d")}\n\\end{pmatrix}`;
    case "bmatrix": return `\\begin{bmatrix}\n  ${field(1, "a")} & ${field(2, "b")} \\\\\n  ${field(3, "c")} & ${field(4, "d")}\n\\end{bmatrix}`;
    case "cases": return `\\begin{cases}\n  ${field(1, chosen(selection, "f_1(x)"))}, & ${field(2, "x < 0")} \\\\\n  ${field(3, "f_2(x)")}, & ${field(4, "x \\geq 0")}\n\\end{cases}`;
    default: {
      const commands: Record<Exclude<MathCommandId,
        "inline" | "display" | "fraction" | "sqrt" | "nth-root" | "superscript" | "subscript" |
        "parentheses" | "brackets" | "absolute" | "sum" | "product" | "integral" | "limit" |
        "derivative" | "partial-derivative" | "vec" | "overrightarrow" | "overleftarrow" | "hat" |
        "widehat" | "tilde" | "widetilde" | "bar" | "overline" | "underline-math" | "dot" | "ddot" |
        "breve" | "check" | "acute" | "grave" | "mathring" | "mathbf" | "boldsymbol" |
        "align" | "pmatrix" | "bmatrix" | "cases"
      >, string> = {
        alpha: "\\alpha", beta: "\\beta", gamma: "\\gamma", delta: "\\delta", epsilon: "\\epsilon",
        zeta: "\\zeta", eta: "\\eta", theta: "\\theta", iota: "\\iota", kappa: "\\kappa",
        lambda: "\\lambda", mu: "\\mu", nu: "\\nu", xi: "\\xi", omicron: "o", pi: "\\pi",
        rho: "\\rho", sigma: "\\sigma", tau: "\\tau", upsilon: "\\upsilon", phi: "\\phi",
        chi: "\\chi", psi: "\\psi", omega: "\\omega",
        varepsilon: "\\varepsilon", vartheta: "\\vartheta", varkappa: "\\varkappa", varpi: "\\varpi",
        varrho: "\\varrho", varsigma: "\\varsigma", varphi: "\\varphi",
        Alpha: "A", Beta: "B", Gamma: "\\Gamma", Delta: "\\Delta", Epsilon: "E", Zeta: "Z",
        Eta: "H", Theta: "\\Theta", Iota: "I", Kappa: "K", Lambda: "\\Lambda", Mu: "M",
        Nu: "N", Xi: "\\Xi", Omicron: "O", Pi: "\\Pi", Rho: "P", Sigma: "\\Sigma", Tau: "T",
        Upsilon: "\\Upsilon", Phi: "\\Phi", Chi: "X", Psi: "\\Psi", Omega: "\\Omega",
        leq: "\\leq", geq: "\\geq",
        neq: "\\neq", approx: "\\approx", in: "\\in", notin: "\\notin", subset: "\\subseteq",
        to: "\\to", mapsto: "\\mapsto", infty: "\\infty", cdot: "\\cdot", times: "\\times", pm: "\\pm",
        planck: "h", hbar: "\\hbar", euler: "\\mathrm{e}", imaginary: "\\mathrm{i}", differential: "\\mathrm{d}",
        nabla: "\\nabla", partial: "\\partial", ell: "\\ell", "real-part": "\\Re", "imaginary-part": "\\Im",
        emptyset: "\\emptyset", forall: "\\forall", exists: "\\exists", propto: "\\propto", angle: "\\angle",
        perp: "\\perp", parallel: "\\parallel", degree: "^{\\circ}", prime: "^{\\prime}", dagger: "\\dagger",
        ddagger: "\\ddagger", aleph: "\\aleph", weierstrass: "\\wp", therefore: "\\therefore", because: "\\because",
      };
      const snippet = commands[command];
      if (!snippet) throw new Error(`Unknown maths command: ${command}`);
      return `${snippet} `;
    }
  }
}

const greek = (id: MathCommandId, label: string, name: string, capital = false): MathCommandOption => ({
  id,
  label,
  title: `${capital ? "Capital" : "Lowercase"} ${name}`,
  group: capital ? "Capital letters" : "Lowercase letters",
});

export const GREEK_COMMANDS: MathCommandOption[] = [
  greek("alpha", "α", "alpha"), greek("beta", "β", "beta"), greek("gamma", "γ", "gamma"),
  greek("delta", "δ", "delta"), greek("epsilon", "ϵ", "epsilon"), greek("zeta", "ζ", "zeta"),
  greek("eta", "η", "eta"), greek("theta", "θ", "theta"), greek("iota", "ι", "iota"),
  greek("kappa", "κ", "kappa"), greek("lambda", "λ", "lambda"), greek("mu", "μ", "mu"),
  greek("nu", "ν", "nu"), greek("xi", "ξ", "xi"), greek("omicron", "ο", "omicron"),
  greek("pi", "π", "pi"), greek("rho", "ρ", "rho"), greek("sigma", "σ", "sigma"),
  greek("tau", "τ", "tau"), greek("upsilon", "υ", "upsilon"), greek("phi", "ϕ", "phi"),
  greek("chi", "χ", "chi"), greek("psi", "ψ", "psi"), greek("omega", "ω", "omega"),
  greek("Alpha", "Α", "alpha", true), greek("Beta", "Β", "beta", true), greek("Gamma", "Γ", "gamma", true),
  greek("Delta", "Δ", "delta", true), greek("Epsilon", "Ε", "epsilon", true), greek("Zeta", "Ζ", "zeta", true),
  greek("Eta", "Η", "eta", true), greek("Theta", "Θ", "theta", true), greek("Iota", "Ι", "iota", true),
  greek("Kappa", "Κ", "kappa", true), greek("Lambda", "Λ", "lambda", true), greek("Mu", "Μ", "mu", true),
  greek("Nu", "Ν", "nu", true), greek("Xi", "Ξ", "xi", true), greek("Omicron", "Ο", "omicron", true),
  greek("Pi", "Π", "pi", true), greek("Rho", "Ρ", "rho", true), greek("Sigma", "Σ", "sigma", true),
  greek("Tau", "Τ", "tau", true), greek("Upsilon", "Υ", "upsilon", true), greek("Phi", "Φ", "phi", true),
  greek("Chi", "Χ", "chi", true), greek("Psi", "Ψ", "psi", true), greek("Omega", "Ω", "omega", true),
  { id: "varepsilon", label: "ε", title: "Variant epsilon", group: "Variant forms" },
  { id: "vartheta", label: "ϑ", title: "Variant theta", group: "Variant forms" },
  { id: "varkappa", label: "ϰ", title: "Variant kappa (amssymb)", group: "Variant forms" },
  { id: "varpi", label: "ϖ", title: "Variant pi", group: "Variant forms" },
  { id: "varrho", label: "ϱ", title: "Variant rho", group: "Variant forms" },
  { id: "varsigma", label: "ς", title: "Variant sigma", group: "Variant forms" },
  { id: "varphi", label: "φ", title: "Variant phi", group: "Variant forms" },
];

export const SYMBOL_COMMANDS: MathCommandOption[] = [
  ["leq", "≤", "Less than or equal"], ["geq", "≥", "Greater than or equal"],
  ["neq", "≠", "Not equal"], ["approx", "≈", "Approximately equal"], ["in", "∈", "Element of"],
  ["notin", "∉", "Not an element of"], ["subset", "⊆", "Subset or equal"], ["to", "→", "Right arrow"],
  ["mapsto", "↦", "Maps to"], ["cdot", "·", "Centred dot"],
  ["times", "×", "Multiplication sign"], ["pm", "±", "Plus or minus"],
].map(([id, label, title]) => ({ id: id as MathCommandId, label, title }));

export const SPECIAL_COMMANDS: MathCommandOption[] = [
  { id: "planck", label: "h", title: "Planck constant", group: "Physical notation" },
  { id: "hbar", label: "ℏ", title: "Reduced Planck constant", group: "Physical notation" },
  { id: "euler", label: "e", title: "Euler’s number (upright)", group: "Physical notation" },
  { id: "imaginary", label: "i", title: "Imaginary unit (upright)", group: "Physical notation" },
  { id: "differential", label: "d", title: "Differential symbol (upright)", group: "Physical notation" },
  { id: "nabla", label: "∇", title: "Nabla", group: "Calculus and sets" },
  { id: "partial", label: "∂", title: "Partial derivative symbol", group: "Calculus and sets" },
  { id: "infty", label: "∞", title: "Infinity", group: "Calculus and sets" },
  { id: "emptyset", label: "∅", title: "Empty set", group: "Calculus and sets" },
  { id: "forall", label: "∀", title: "For all", group: "Calculus and sets" },
  { id: "exists", label: "∃", title: "There exists", group: "Calculus and sets" },
  { id: "propto", label: "∝", title: "Proportional to", group: "Calculus and sets" },
  { id: "angle", label: "∠", title: "Angle", group: "Geometry" },
  { id: "perp", label: "⊥", title: "Perpendicular", group: "Geometry" },
  { id: "parallel", label: "∥", title: "Parallel", group: "Geometry" },
  { id: "degree", label: "°", title: "Degree", group: "Geometry" },
  { id: "prime", label: "′", title: "Prime", group: "Geometry" },
  { id: "ell", label: "ℓ", title: "Script ell", group: "Other notation" },
  { id: "real-part", label: "ℜ", title: "Real part", group: "Other notation" },
  { id: "imaginary-part", label: "ℑ", title: "Imaginary part", group: "Other notation" },
  { id: "aleph", label: "ℵ", title: "Aleph", group: "Other notation" },
  { id: "weierstrass", label: "℘", title: "Weierstrass p", group: "Other notation" },
  { id: "dagger", label: "†", title: "Dagger", group: "Other notation" },
  { id: "ddagger", label: "‡", title: "Double dagger", group: "Other notation" },
  { id: "therefore", label: "∴", title: "Therefore (amssymb)", group: "Other notation" },
  { id: "because", label: "∵", title: "Because (amssymb)", group: "Other notation" },
];

export const ACCENT_COMMANDS: MathCommandOption[] = [
  { id: "vec", label: "\\vec{x}", title: "Vector arrow", group: "Vectors" },
  { id: "overrightarrow", label: "\\overrightarrow{AB}", title: "Long right vector arrow", group: "Vectors" },
  { id: "overleftarrow", label: "\\overleftarrow{AB}", title: "Long left vector arrow", group: "Vectors" },
  { id: "mathbf", label: "\\mathbf{v}", title: "Bold Roman vector", group: "Vectors" },
  { id: "boldsymbol", label: "\\boldsymbol{v}", title: "Bold mathematical symbol (amsmath)", group: "Vectors" },
  { id: "hat", label: "\\hat{x}", title: "Hat", group: "Accents" },
  { id: "widehat", label: "\\widehat{ABC}", title: "Wide hat", group: "Accents" },
  { id: "tilde", label: "\\tilde{x}", title: "Tilde", group: "Accents" },
  { id: "widetilde", label: "\\widetilde{ABC}", title: "Wide tilde", group: "Accents" },
  { id: "bar", label: "\\bar{x}", title: "Bar", group: "Lines" },
  { id: "overline", label: "\\overline{AB}", title: "Overline", group: "Lines" },
  { id: "underline-math", label: "\\underline{x}", title: "Underline", group: "Lines" },
  { id: "dot", label: "\\dot{x}", title: "Dot", group: "Dots and marks" },
  { id: "ddot", label: "\\ddot{x}", title: "Double dot", group: "Dots and marks" },
  { id: "breve", label: "\\breve{x}", title: "Breve", group: "Dots and marks" },
  { id: "check", label: "\\check{x}", title: "Check", group: "Dots and marks" },
  { id: "acute", label: "\\acute{x}", title: "Acute accent", group: "Dots and marks" },
  { id: "grave", label: "\\grave{x}", title: "Grave accent", group: "Dots and marks" },
  { id: "mathring", label: "\\mathring{x}", title: "Ring", group: "Dots and marks" },
];

export const STRUCTURE_COMMANDS: MathCommandOption[] = [
  { id: "align", label: "Aligned equations", title: "Insert an align environment" },
  { id: "pmatrix", label: "Round matrix", title: "Insert a pmatrix environment" },
  { id: "bmatrix", label: "Square matrix", title: "Insert a bmatrix environment" },
  { id: "cases", label: "Cases", title: "Insert a cases environment" },
];
