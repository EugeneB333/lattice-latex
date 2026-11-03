export type TableAlignment = "l" | "c" | "r";
export type TableRuleStyle = "none" | "outer" | "standard" | "grid" | "booktabs";
export type TableVerticalRules = "none" | "outer" | "all";
export type TablePosition = "default" | "left" | "center" | "right";
export type TableFontSize = "normal" | "small" | "footnotesize";
export type TableRowSpacing = "compact" | "normal" | "relaxed" | "spacious";
export type TablePlacement = "htbp" | "h" | "t" | "b" | "p";
export type TableCaptionPosition = "above" | "below";

export interface TableCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  backgroundColor?: string;
  textColor?: string;
  alignment?: TableAlignment;
}

export interface ParsedTable {
  rows: string[][];
  hasHeader: boolean;
  alignments: TableAlignment[];
  cellStyles: TableCellStyle[][];
}

export interface LatexTableOptions {
  rows: string[][];
  alignments?: TableAlignment[];
  hasHeader?: boolean;
  boldHeader?: boolean;
  boldFirstColumn?: boolean;
  ruleStyle?: TableRuleStyle;
  verticalRules?: TableVerticalRules;
  position?: TablePosition;
  fontSize?: TableFontSize;
  rowSpacing?: TableRowSpacing;
  floating?: boolean;
  placement?: TablePlacement;
  caption?: string;
  captionPosition?: TableCaptionPosition;
  label?: string;
  cellStyles?: TableCellStyle[][];
  stripedRows?: boolean;
  stripeColor?: string;
  ruleColor?: string;
}

export interface ClipboardTableData {
  html?: string;
  text?: string;
}

export interface TablePasteEvent {
  clipboardData: { getData: (format: string) => string } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function rectangularRows(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ""));
}

function nonEmptyRows(rows: string[][]): string[][] {
  const copy = rows.map((row) => [...row]);
  while (copy.length > 1 && copy.at(-1)?.every((cell) => cell === "")) copy.pop();
  return copy;
}

/** Parse tabular clipboard text, including quoted delimiters and line breaks. */
export function parseDelimitedTable(text: string, delimiter = "\t"): string[][] {
  if (!text) return [];
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;

  const finishField = () => {
    rows[rows.length - 1].push(field);
    field = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      finishField();
    } else if ((character === "\n" || character === "\r") && !quoted) {
      finishField();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      rows.push([]);
    } else {
      field += character;
    }
  }
  finishField();
  return rectangularRows(nonEmptyRows(rows));
}

function cleanHtmlCell(cell: Element): string {
  return (cell.textContent ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function cssColorToHex(value: string): string | undefined {
  const color = value.trim().toLowerCase();
  const shortHex = /^#?([0-9a-f]{3})$/i.exec(color);
  if (shortHex) return [...shortHex[1]].map((digit) => digit.repeat(2)).join("").toUpperCase();
  const hex = /^#?([0-9a-f]{6})$/i.exec(color);
  if (hex) return hex[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  if (rgb) return rgb.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("").toUpperCase();
  const named: Record<string, string> = {
    black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
    yellow: "FFFF00", orange: "FFA500", purple: "800080", gray: "808080", grey: "808080",
  };
  return named[color];
}

function parseHtmlCellStyle(cell: HTMLElement): TableCellStyle {
  const fontWeight = cell.style.fontWeight;
  const numericWeight = Number(fontWeight);
  const backgroundColor = cssColorToHex(cell.style.backgroundColor || cell.getAttribute("bgcolor") || "");
  const textColor = cssColorToHex(cell.style.color || cell.getAttribute("color") || "");
  const textAlign = (cell.style.textAlign || cell.getAttribute("align") || "").toLowerCase();
  const alignment = textAlign === "center" ? "c" : textAlign === "right" ? "r" : textAlign === "left" ? "l" : undefined;
  return {
    ...(fontWeight === "bold" || Number.isFinite(numericWeight) && numericWeight >= 600 ? { bold: true } : {}),
    ...(cell.style.fontStyle === "italic" ? { italic: true } : {}),
    ...(cell.style.textDecorationLine.includes("underline") || cell.style.textDecoration.includes("underline") ? { underline: true } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(textColor ? { textColor } : {}),
    ...(alignment ? { alignment } : {}),
  };
}

function parseHtmlTable(html: string): Pick<ParsedTable, "rows" | "hasHeader" | "cellStyles"> | undefined {
  if (!html || typeof DOMParser === "undefined") return undefined;
  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("table");
  if (!table) return undefined;
  const parsedRows = [...table.querySelectorAll("tr")]
    .filter((row) => row.closest("table") === table)
    .map((row) => {
      const cells = [...row.children].filter((cell) => cell.matches("th, td"));
      return {
        values: cells.flatMap((cell) => {
        const span = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
        return [cleanHtmlCell(cell), ...Array.from({ length: span - 1 }, () => "")];
        }),
        styles: cells.flatMap((cell) => {
          const span = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
          return [parseHtmlCellStyle(cell as HTMLElement), ...Array.from({ length: span - 1 }, () => ({}))];
        }),
      };
    }).filter((row) => row.values.length);
  const rows = rectangularRows(parsedRows.map((row) => row.values));
  if (!rows.length || !rows[0].length) return undefined;
  const width = rows[0].length;
  const cellStyles = parsedRows.map((row) => Array.from({ length: width }, (_, column) => row.styles[column] ?? {}));
  const firstRow = table.querySelector("tr");
  return { rows, hasHeader: Boolean(firstRow?.querySelector("th")), cellStyles };
}

function isNumericCell(value: string): boolean {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return false;
  return /^\(?[-+]?\s*[$£€¥]?\s*\d+(?:\.\d+)?%?\)?$/.test(normalized);
}

export function inferTableAlignments(rows: string[][], hasHeader = false): TableAlignment[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: width }, (_, column) => {
    const values = rows.slice(hasHeader ? 1 : 0).map((row) => row[column] ?? "").filter((value) => value.trim());
    const bodyValues = !hasHeader && values.length > 1 && !isNumericCell(values[0]) ? values.slice(1) : values;
    return bodyValues.length > 0 && bodyValues.every(isNumericCell) ? "r" : "l";
  });
}

/** Prefer the rich HTML table supplied by spreadsheet apps, with TSV as a safe fallback. */
export function parseClipboardTable(data: ClipboardTableData): ParsedTable | undefined {
  const htmlTable = parseHtmlTable(data.html ?? "");
  if (htmlTable) {
    return { ...htmlTable, alignments: inferTableAlignments(htmlTable.rows, htmlTable.hasHeader) };
  }

  if (!(data.text ?? "").includes("\t")) return undefined;
  const rows = parseDelimitedTable(data.text ?? "");
  if (rows.length < 2 || Math.max(0, ...rows.map((row) => row.length)) < 2) return undefined;
  return { rows, hasHeader: false, alignments: inferTableAlignments(rows), cellStyles: rows.map((row) => row.map(() => ({}))) };
}

export function escapeLatexTableCell(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    "_": "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return [...value.replace(/\r?\n/g, " ")].map((character) => replacements[character] ?? character).join("");
}

export function normalizeLatexLabel(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[{}\\%#&$~^]+/g, "-").replace(/-+/g, "-");
}

export function createEmptyTable(rowCount = 3, columnCount = 3): string[][] {
  return Array.from({ length: Math.max(1, rowCount) }, () => Array.from({ length: Math.max(1, columnCount) }, () => ""));
}

export function pasteTableCells(base: string[][], incoming: string[][], startRow: number, startColumn: number): string[][] {
  const baseWidth = Math.max(1, ...base.map((row) => row.length));
  const incomingWidth = Math.max(0, ...incoming.map((row) => row.length));
  const height = Math.max(base.length, startRow + incoming.length, 1);
  const width = Math.max(baseWidth, startColumn + incomingWidth, 1);
  const result = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) => base[row]?.[column] ?? ""));
  incoming.forEach((row, rowOffset) => row.forEach((cell, columnOffset) => {
    result[startRow + rowOffset][startColumn + columnOffset] = cell;
  }));
  return result;
}

function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return cssColorToHex(value);
}

export function getLatexTablePackages(options: LatexTableOptions): string[] {
  const packages: string[] = [];
  if ((options.cellStyles ?? []).some((row) => row.some((style) => style.backgroundColor || style.textColor))
    || options.stripedRows || options.ruleColor) packages.push("\\usepackage[table]{xcolor}");
  if ((options.ruleStyle ?? "standard") === "booktabs") packages.push("\\usepackage{booktabs}");
  return packages;
}

export function generateLatexTable(options: LatexTableOptions): string {
  const rows = rectangularRows(options.rows.length ? options.rows : [[""]]);
  const width = Math.max(1, rows[0]?.length ?? 0);
  const alignments = Array.from({ length: width }, (_, column) => options.alignments?.[column] ?? "l");
  const hasHeader = Boolean(options.hasHeader && rows.length);
  const boldHeader = options.boldHeader ?? true;
  const boldFirstColumn = Boolean(options.boldFirstColumn);
  const ruleStyle = options.ruleStyle ?? "standard";
  const verticalRules = ruleStyle === "booktabs" ? "none" : options.verticalRules ?? "none";
  const columnSpecification = verticalRules === "all"
    ? `|${alignments.join("|")}|`
    : verticalRules === "outer"
      ? `|${alignments.join("")}|`
      : alignments.join("");
  const body: string[] = [`\\begin{tabular}{${columnSpecification}}`];

  if (ruleStyle === "booktabs") body.push("  \\toprule");
  else if (ruleStyle === "outer" || ruleStyle === "standard" || ruleStyle === "grid") body.push("  \\hline");

  rows.forEach((row, rowIndex) => {
    const stripeColor = normalizeHexColor(options.stripeColor) ?? "F3F4F6";
    const dataRowIndex = rowIndex - (hasHeader ? 1 : 0);
    if (options.stripedRows && dataRowIndex >= 0 && dataRowIndex % 2 === 1) body.push(`  \\rowcolor[HTML]{${stripeColor}}`);
    const cells = row.map((cell, columnIndex) => {
      const style = options.cellStyles?.[rowIndex]?.[columnIndex];
      let formattedCell = escapeLatexTableCell(cell.trim());
      if (style?.underline) formattedCell = `\\underline{${formattedCell}}`;
      if (style?.italic) formattedCell = `\\textit{${formattedCell}}`;
      if ((hasHeader && boldHeader && rowIndex === 0) || (boldFirstColumn && columnIndex === 0) || style?.bold) formattedCell = `\\textbf{${formattedCell}}`;
      const textColor = normalizeHexColor(style?.textColor);
      if (textColor) formattedCell = `\\textcolor[HTML]{${textColor}}{${formattedCell}}`;
      const backgroundColor = normalizeHexColor(style?.backgroundColor);
      if (backgroundColor) formattedCell = `\\cellcolor[HTML]{${backgroundColor}}${formattedCell}`;
      if (style?.alignment && style.alignment !== alignments[columnIndex]) {
        const cellRules = verticalRules === "all"
          ? `|${style.alignment}|`
          : verticalRules === "outer"
            ? `${columnIndex === 0 ? "|" : ""}${style.alignment}${columnIndex === width - 1 ? "|" : ""}`
            : style.alignment;
        formattedCell = `\\multicolumn{1}{${cellRules}}{${formattedCell}}`;
      }
      return formattedCell;
    });
    body.push(`  ${cells.join(" & ")} \\\\`);
    if (ruleStyle === "grid") body.push("  \\hline");
    else if (hasHeader && rowIndex === 0) {
      if (ruleStyle === "booktabs") body.push("  \\midrule");
      else if (ruleStyle === "standard") body.push("  \\hline");
    }
  });

  if (ruleStyle === "booktabs") body.push("  \\bottomrule");
  else if (ruleStyle === "outer" || ruleStyle === "standard") body.push("  \\hline");
  body.push("\\end{tabular}");

  const rowSpacing = options.rowSpacing ?? "normal";
  const rowSpacingValues: Record<TableRowSpacing, string> = { compact: "0.85", normal: "1", relaxed: "1.25", spacious: "1.5" };
  const fontSize = options.fontSize ?? "normal";
  let formatted = body;
  const ruleColor = normalizeHexColor(options.ruleColor);
  if (fontSize !== "normal" || rowSpacing !== "normal" || ruleColor) {
    formatted = [
      "\\begingroup",
      ...(fontSize === "normal" ? [] : [`  \\${fontSize}`]),
      ...(rowSpacing === "normal" ? [] : [`  \\renewcommand{\\arraystretch}{${rowSpacingValues[rowSpacing]}}`]),
      ...(ruleColor ? [`  \\arrayrulecolor[HTML]{${ruleColor}}`] : []),
      ...body.map((line) => `  ${line}`),
      "\\endgroup",
    ];
  }

  const position = options.position ?? "default";
  if (!options.floating) {
    if (position === "center" || position === "right") {
      const environment = position === "center" ? "center" : "flushright";
      return [`\\begin{${environment}}`, ...formatted.map((line) => `  ${line}`), `\\end{${environment}}`].join("\n");
    }
    return formatted.join("\n");
  }

  const placement = options.placement ?? "htbp";
  const floating = [`\\begin{table}[${placement}]`];
  if (position === "left") floating.push("  \\raggedright");
  else if (position === "right") floating.push("  \\raggedleft");
  else floating.push("  \\centering");
  const captionLines: string[] = [];
  if (options.caption?.trim()) captionLines.push(`  \\caption{${escapeLatexTableCell(options.caption.trim())}}`);
  const normalizedLabel = normalizeLatexLabel(options.label ?? "");
  if (normalizedLabel) captionLines.push(`  \\label{${normalizedLabel}}`);
  if ((options.captionPosition ?? "below") === "above") floating.push(...captionLines);
  floating.push(...formatted.map((line) => `  ${line}`));
  if ((options.captionPosition ?? "below") === "below") floating.push(...captionLines);
  floating.push("\\end{table}");
  return floating.join("\n");
}

export function clipboardTableToLatex(data: ClipboardTableData): string | undefined {
  const parsed = parseClipboardTable(data);
  if (!parsed) return undefined;
  return generateLatexTable({
    rows: parsed.rows,
    alignments: parsed.alignments,
    hasHeader: parsed.hasHeader,
    ruleStyle: "standard",
  });
}

/** Consume a paste only when its clipboard payload is unambiguously tabular. */
export function handleSmartTablePaste(event: TablePasteEvent, insert: (latex: string) => void): boolean {
  if (!event.clipboardData) return false;
  const latex = clipboardTableToLatex({
    html: event.clipboardData.getData("text/html"),
    text: event.clipboardData.getData("text/plain"),
  });
  if (!latex) return false;
  event.preventDefault();
  event.stopPropagation();
  insert(latex);
  return true;
}
