import type {
  LatexTableOptions,
  TableAlignment,
  TableCellStyle,
  TableFontSize,
  TablePlacement,
  TablePosition,
  TableRowSpacing,
  TableRuleStyle,
  TableVerticalRules,
} from "./latexTable";

export interface EditableLatexTable {
  startOffset: number;
  endOffset: number;
  options: LatexTableOptions;
}

export type LatexTableParseResult =
  | { table: EditableLatexTable; error?: never }
  | { table?: never; error: string };

interface EnvironmentRange {
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  opening: string;
}

function sourceWithoutComments(source: string): string {
  return source.split("\n").map((line) => {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "%") continue;
      let slashCount = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashCount += 1;
      if (slashCount % 2 === 0) return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
    }
    return line;
  }).join("\n");
}

function environmentRanges(source: string, environment: string): EnvironmentRange[] {
  const clean = sourceWithoutComments(source);
  const escaped = environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`\\\\(begin|end)\\s*\\{${escaped}\\}(?:\\s*\\[[^\\]]*\\])?`, "g");
  const stack: Array<{ start: number; contentStart: number; opening: string }> = [];
  const ranges: EnvironmentRange[] = [];
  for (const match of clean.matchAll(token)) {
    if (match[1] === "begin") {
      let opening = match[0];
      let contentStart = match.index + match[0].length;
      if (environment === "tabular") {
        const specification = /^\s*\{[^}]*\}/.exec(source.slice(contentStart));
        if (specification) {
          opening += source.slice(contentStart, contentStart + specification[0].length);
          contentStart += specification[0].length;
        }
      }
      stack.push({ start: match.index, contentStart, opening });
    }
    else {
      const opening = stack.pop();
      if (opening) ranges.push({ ...opening, contentEnd: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function groupRanges(source: string): EnvironmentRange[] {
  const clean = sourceWithoutComments(source);
  const token = /\\(begingroup|endgroup)\b/g;
  const stack: Array<{ start: number; contentStart: number; opening: string }> = [];
  const ranges: EnvironmentRange[] = [];
  for (const match of clean.matchAll(token)) {
    if (match[1] === "begingroup") stack.push({ start: match.index, contentStart: match.index + match[0].length, opening: match[0] });
    else {
      const opening = stack.pop();
      if (opening) ranges.push({ ...opening, contentEnd: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

function containing(ranges: EnvironmentRange[], offset: number): EnvironmentRange | undefined {
  return ranges.filter((range) => offset >= range.start && offset <= range.end).sort((left, right) => left.end - left.start - (right.end - right.start))[0];
}

function enclosing(ranges: EnvironmentRange[], inner: EnvironmentRange): EnvironmentRange | undefined {
  return ranges.filter((range) => range.start <= inner.start && range.end >= inner.end)
    .sort((left, right) => left.end - left.start - (right.end - right.start))[0];
}

function splitTopLevel(value: string, delimiter: "&" | "\\\\"): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "{" && (index === 0 || value[index - 1] !== "\\")) depth += 1;
    else if (character === "}" && (index === 0 || value[index - 1] !== "\\")) depth = Math.max(0, depth - 1);
    else if (depth === 0 && delimiter === "&" && character === "&" && value[index - 1] !== "\\") {
      parts.push(value.slice(start, index));
      start = index + 1;
    } else if (depth === 0 && delimiter === "\\\\" && character === "\\" && value[index + 1] === "\\") {
      parts.push(value.slice(start, index));
      start = index + 2;
      index += 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function bracedArgument(value: string, start: number): { value: string; end: number } | undefined {
  if (value[start] !== "{") return undefined;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "{" && (index === 0 || value[index - 1] !== "\\")) depth += 1;
    else if (value[index] === "}" && value[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return { value: value.slice(start + 1, index), end: index + 1 };
    }
  }
  return undefined;
}

function unwrap(value: string, command: string): string | undefined {
  const prefix = `\\${command}`;
  if (!value.startsWith(prefix)) return undefined;
  const argument = bracedArgument(value, prefix.length);
  return argument && argument.end === value.length ? argument.value : undefined;
}

function unescapeCell(value: string): string | undefined {
  const tokens: Array<[RegExp, string]> = [
    [/\\textbackslash\{\}/g, "\\"], [/\\textasciitilde\{\}/g, "~"], [/\\textasciicircum\{\}/g, "^"],
    [/\\&/g, "&"], [/\\%/g, "%"], [/\\\$/g, "$"], [/\\#/g, "#"], [/\\_/g, "_"], [/\\\{/g, "{"], [/\\\}/g, "}"],
  ];
  let unknownCheck = value;
  for (const [pattern] of tokens) unknownCheck = unknownCheck.replace(pattern, "");
  if (/\\[A-Za-z]+|(^|[^\\])\$/.test(unknownCheck)) return undefined;
  let result = value;
  for (const [pattern, replacement] of tokens) result = result.replace(pattern, replacement);
  return result;
}

function parseCell(raw: string): { value: string; style: TableCellStyle } | undefined {
  let value = raw.trim();
  const style: TableCellStyle = {};
  if (value.startsWith("\\multicolumn")) {
    let cursor = "\\multicolumn".length;
    const span = bracedArgument(value, cursor);
    if (!span || span.value.trim() !== "1") return undefined;
    cursor = span.end;
    const specification = bracedArgument(value, cursor);
    if (!specification) return undefined;
    const alignment = specification.value.replace(/\|/g, "").trim();
    if (!["l", "c", "r"].includes(alignment)) return undefined;
    style.alignment = alignment as TableAlignment;
    cursor = specification.end;
    const content = bracedArgument(value, cursor);
    if (!content || content.end !== value.length) return undefined;
    value = content.value.trim();
  }
  const background = /^\\cellcolor\[HTML\]\{([0-9a-f]{6})\}/i.exec(value);
  if (background) {
    style.backgroundColor = background[1].toUpperCase();
    value = value.slice(background[0].length).trim();
  }
  const textColor = /^\\textcolor\[HTML\]\{([0-9a-f]{6})\}/i.exec(value);
  if (textColor) {
    const content = bracedArgument(value, textColor[0].length);
    if (!content || content.end !== value.length) return undefined;
    style.textColor = textColor[1].toUpperCase();
    value = content.value.trim();
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [command, property] of [["textbf", "bold"], ["textit", "italic"], ["underline", "underline"]] as const) {
      const content = unwrap(value, command);
      if (content !== undefined) {
        style[property] = true;
        value = content.trim();
        changed = true;
        break;
      }
    }
  }
  const plain = unescapeCell(value);
  return plain === undefined ? undefined : { value: plain, style };
}

function parseColumnSpecification(specification: string): { alignments: TableAlignment[]; verticalRules: TableVerticalRules } | undefined {
  const compact = specification.replace(/\s/g, "");
  if (/[^lcr|]/.test(compact)) return undefined;
  const alignments = [...compact].filter((value): value is TableAlignment => value === "l" || value === "c" || value === "r");
  if (!alignments.length) return undefined;
  const bars = [...compact].filter((value) => value === "|").length;
  const verticalRules = bars === 0 ? "none" : bars === alignments.length + 1 ? "all" : bars === 2 && compact.startsWith("|") && compact.endsWith("|") ? "outer" : undefined;
  return verticalRules ? { alignments, verticalRules } : undefined;
}

function extractCommandArgument(source: string, command: string): { value: string; index: number } | undefined {
  const index = source.indexOf(`\\${command}`);
  if (index < 0) return undefined;
  const brace = source.indexOf("{", index + command.length + 1);
  const argument = bracedArgument(source, brace);
  return argument ? { value: argument.value, index } : undefined;
}

function parseTableBlock(source: string, tabular: EnvironmentRange, replacement: EnvironmentRange): LatexTableOptions | undefined {
  const columnMatch = /\\begin\s*\{tabular\}\s*\{([^}]*)\}/.exec(tabular.opening);
  if (!columnMatch) return undefined;
  const columns = parseColumnSpecification(columnMatch[1]);
  if (!columns) return undefined;
  const rows: string[][] = [];
  const cellStyles: TableCellStyle[][] = [];
  const rulePositions: number[] = [];
  const midrulePositions: number[] = [];
  const rowColors = new Map<number, string>();
  let pendingRowColor: string | undefined;
  const statements = splitTopLevel(sourceWithoutComments(source.slice(tabular.contentStart, tabular.contentEnd)), "\\\\");
  for (const statement of statements) {
    let value = statement.trim();
    if (!value) continue;
    const commands = [...value.matchAll(/\\(toprule|midrule|bottomrule|hline)\b/g)];
    for (const command of commands) {
      if (command[1] === "midrule") midrulePositions.push(rows.length);
      if (command[1] === "hline") rulePositions.push(rows.length);
    }
    value = value.replace(/\\(toprule|midrule|bottomrule|hline)\b/g, "").trim();
    const rowColor = /^\\rowcolor\[HTML\]\{([0-9a-f]{6})\}\s*/i.exec(value);
    if (rowColor) {
      pendingRowColor = rowColor[1].toUpperCase();
      value = value.slice(rowColor[0].length).trim();
    }
    if (!value) continue;
    const parsed = splitTopLevel(value, "&").map(parseCell);
    if (parsed.some((cell) => !cell) || parsed.length !== columns.alignments.length) return undefined;
    rows.push(parsed.map((cell) => cell!.value));
    cellStyles.push(parsed.map((cell) => cell!.style));
    if (pendingRowColor) {
      rowColors.set(rows.length - 1, pendingRowColor);
      pendingRowColor = undefined;
    }
  }
  if (!rows.length) return undefined;

  const replacementSource = source.slice(replacement.start, replacement.end);
  const booktabs = /\\(?:toprule|midrule|bottomrule)\b/.test(source.slice(tabular.contentStart, tabular.contentEnd));
  const firstRowBold = cellStyles[0].every((style) => style.bold);
  let ruleStyle: TableRuleStyle = "none";
  if (booktabs) ruleStyle = "booktabs";
  else if (Array.from({ length: rows.length + 1 }, (_, index) => index).every((index) => rulePositions.includes(index))) ruleStyle = "grid";
  else if (rulePositions.includes(0) && rulePositions.includes(rows.length) && rulePositions.includes(1) && rows.length > 1 && rulePositions.length === 3) ruleStyle = "standard";
  else if (rulePositions.includes(0) && rulePositions.includes(rows.length)) ruleStyle = "outer";
  const hasHeader = midrulePositions.includes(1)
    || ruleStyle === "standard" && rulePositions.includes(1)
    || ruleStyle === "grid" && rows.length > 1 && firstRowBold;

  if (hasHeader && firstRowBold) cellStyles[0].forEach((style) => { style.bold = undefined; });
  const bodyStart = hasHeader ? 1 : 0;
  const boldFirstColumn = rows.slice(bodyStart).length > 0 && rows.slice(bodyStart).every((_, index) => cellStyles[index + bodyStart][0]?.bold);
  if (boldFirstColumn) rows.slice(bodyStart).forEach((_, index) => { cellStyles[index + bodyStart][0].bold = undefined; });

  const expectedStripeRows = rows.map((_, index) => index).filter((index) => index >= bodyStart && (index - bodyStart) % 2 === 1);
  const stripeValues = [...rowColors.values()];
  const stripedRows = expectedStripeRows.length > 0 && rowColors.size === expectedStripeRows.length
    && expectedStripeRows.every((index) => rowColors.has(index)) && stripeValues.every((color) => color === stripeValues[0]);
  if (!stripedRows) rowColors.forEach((color, row) => cellStyles[row].forEach((style) => { style.backgroundColor = color; }));

  const tableEnvironment = replacement.opening.match(/\\begin\s*\{table\}(?:\s*\[([^\]]*)\])?/);
  const caption = extractCommandArgument(replacementSource, "caption");
  const label = extractCommandArgument(replacementSource, "label");
  const position: TablePosition = /\\raggedright\b/.test(replacementSource) ? "left"
    : /\\raggedleft\b/.test(replacementSource) ? "right"
      : /\\centering\b/.test(replacementSource) || /\\begin\s*\{center\}/.test(replacementSource) ? "center"
        : /\\begin\s*\{flushright\}/.test(replacementSource) ? "right" : "default";
  const rowSpacingMatch = /\\renewcommand\s*\{\\arraystretch\}\s*\{(0\.85|1\.25|1\.5)\}/.exec(replacementSource);
  const rowSpacing: TableRowSpacing = rowSpacingMatch?.[1] === "0.85" ? "compact" : rowSpacingMatch?.[1] === "1.25" ? "relaxed" : rowSpacingMatch?.[1] === "1.5" ? "spacious" : "normal";
  const fontSize: TableFontSize = /\\footnotesize\b/.test(replacementSource) ? "footnotesize" : /\\small\b/.test(replacementSource) ? "small" : "normal";
  const ruleColor = /\\arrayrulecolor\[HTML\]\{([0-9a-f]{6})\}/i.exec(replacementSource)?.[1].toUpperCase();

  const rawPlacement = tableEnvironment?.[1] ?? "htbp";
  const placement: TablePlacement = (["htbp", "h", "t", "b", "p"] as const).includes(rawPlacement as TablePlacement)
    ? rawPlacement as TablePlacement : "htbp";
  return {
    rows,
    alignments: columns.alignments,
    cellStyles,
    hasHeader,
    boldHeader: firstRowBold,
    boldFirstColumn,
    ruleStyle,
    verticalRules: booktabs ? "none" : columns.verticalRules,
    position,
    fontSize,
    rowSpacing,
    floating: Boolean(tableEnvironment),
    placement,
    caption: caption ? unescapeCell(caption.value) ?? caption.value : "",
    captionPosition: caption && replacementSource.indexOf("\\caption") < replacementSource.indexOf("\\begin{tabular}") ? "above" : "below",
    label: label?.value ?? "",
    stripedRows,
    stripeColor: stripedRows ? `#${stripeValues[0]}` : undefined,
    ruleColor: ruleColor ? `#${ruleColor}` : undefined,
  };
}

/** Locate and parse a supported table around a source offset without changing the document. */
export function parseLatexTableAt(source: string, offset: number): LatexTableParseResult {
  const tabularRanges = environmentRanges(source, "tabular");
  let tabular = containing(tabularRanges, offset);
  const tableRange = containing(environmentRanges(source, "table"), offset);
  if (!tabular && tableRange) tabular = tabularRanges.find((range) => range.start >= tableRange.start && range.end <= tableRange.end);
  if (!tabular) return { error: "No editable table was found at that position." };

  const outerTable = enclosing(environmentRanges(source, "table"), tabular);
  const outerCenter = enclosing(environmentRanges(source, "center"), tabular) ?? enclosing(environmentRanges(source, "flushright"), tabular);
  const outerGroup = enclosing(groupRanges(source), tabular);
  const replacement = outerTable ?? outerCenter ?? outerGroup ?? tabular;
  const options = parseTableBlock(source, tabular, replacement);
  if (!options) return { error: "This table uses LaTeX constructs the graphical editor cannot safely preserve." };
  return { table: { startOffset: replacement.start, endOffset: replacement.end, options } };
}
