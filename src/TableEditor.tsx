import { AlignCenter, AlignLeft, AlignRight, Bold, Eraser, Italic, Plus, Table2, Trash2, Underline, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import {
  createEmptyTable,
  generateLatexTable,
  getLatexTablePackages,
  inferTableAlignments,
  parseClipboardTable,
  parseDelimitedTable,
  pasteTableCells,
  type TableAlignment,
  type TableCellStyle,
  type TableCaptionPosition,
  type TableFontSize,
  type LatexTableOptions,
  type TablePlacement,
  type TablePosition,
  type TableRowSpacing,
  type TableRuleStyle,
  type TableVerticalRules,
} from "./latexTable";

interface CellPosition { row: number; column: number }
interface CellRange { start: CellPosition; end: CellPosition }

function rangeBounds(range: CellRange) {
  return {
    firstRow: Math.min(range.start.row, range.end.row),
    lastRow: Math.max(range.start.row, range.end.row),
    firstColumn: Math.min(range.start.column, range.end.column),
    lastColumn: Math.max(range.start.column, range.end.column),
  };
}

function inRange(range: CellRange, row: number, column: number) {
  const bounds = rangeBounds(range);
  return row >= bounds.firstRow && row <= bounds.lastRow && column >= bounds.firstColumn && column <= bounds.lastColumn;
}

function blankStyles(rows: string[][]): TableCellStyle[][] {
  return rows.map((row) => row.map(() => ({})));
}

function resizeStyles(styles: TableCellStyle[][], rows: string[][]): TableCellStyle[][] {
  return rows.map((row, rowIndex) => row.map((_, columnIndex) => styles[rowIndex]?.[columnIndex] ?? {}));
}

function cssColor(value?: string) {
  return value ? (value.startsWith("#") ? value : `#${value}`) : undefined;
}

function pasteStyles(base: TableCellStyle[][], incoming: TableCellStyle[][], rows: string[][], startRow: number, startColumn: number) {
  const result = resizeStyles(base, rows);
  incoming.forEach((row, rowOffset) => row.forEach((style, columnOffset) => {
    result[startRow + rowOffset][startColumn + columnOffset] = style;
  }));
  return result;
}

export interface TableEditorProps {
  onClose: () => void;
  onInsert: (latex: string, requiredPackages: string[]) => void | Promise<void>;
  initialTable?: LatexTableOptions;
}

function alignmentLabel(alignment: TableAlignment) {
  if (alignment === "c") return "Centre";
  if (alignment === "r") return "Right";
  return "Left";
}

function AlignmentIcon({ alignment }: { alignment: TableAlignment }) {
  if (alignment === "c") return <AlignCenter size={12} />;
  if (alignment === "r") return <AlignRight size={12} />;
  return <AlignLeft size={12} />;
}

export function TableEditor({ onClose, onInsert, initialTable }: TableEditorProps) {
  const [rows, setRows] = useState(() => initialTable?.rows?.length ? initialTable.rows.map((row) => [...row]) : createEmptyTable());
  const [cellStyles, setCellStyles] = useState<TableCellStyle[][]>(() => initialTable?.cellStyles
    ? resizeStyles(initialTable.cellStyles, initialTable.rows) : blankStyles(initialTable?.rows?.length ? initialTable.rows : createEmptyTable()));
  const [selection, setSelection] = useState<CellRange>({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
  const [fillPicker, setFillPicker] = useState("#fff2cc");
  const [textPicker, setTextPicker] = useState("#c00000");
  const [stripedRows, setStripedRows] = useState(Boolean(initialTable?.stripedRows));
  const [stripeColor, setStripeColor] = useState(initialTable?.stripeColor ?? "#f2f2f2");
  const [ruleColor, setRuleColor] = useState(initialTable?.ruleColor ?? "#000000");
  const [customRuleColor, setCustomRuleColor] = useState(Boolean(initialTable?.ruleColor));
  const [inserting, setInserting] = useState(false);
  const [alignments, setAlignments] = useState<TableAlignment[]>(() => initialTable?.alignments?.length
    ? [...initialTable.alignments] : Array.from({ length: Math.max(1, ...rows.map((row) => row.length)) }, () => "l"));
  const [hasHeader, setHasHeader] = useState(Boolean(initialTable?.hasHeader));
  const [boldHeader, setBoldHeader] = useState(initialTable?.boldHeader ?? true);
  const [boldFirstColumn, setBoldFirstColumn] = useState(Boolean(initialTable?.boldFirstColumn));
  const [ruleStyle, setRuleStyle] = useState<TableRuleStyle>(initialTable?.ruleStyle ?? "standard");
  const [verticalRules, setVerticalRules] = useState<TableVerticalRules>(initialTable?.verticalRules ?? "none");
  const [position, setPosition] = useState<TablePosition>(initialTable?.position ?? "default");
  const [fontSize, setFontSize] = useState<TableFontSize>(initialTable?.fontSize ?? "normal");
  const [rowSpacing, setRowSpacing] = useState<TableRowSpacing>(initialTable?.rowSpacing ?? "normal");
  const [floating, setFloating] = useState(Boolean(initialTable?.floating));
  const [placement, setPlacement] = useState<TablePlacement>(initialTable?.placement ?? "htbp");
  const [caption, setCaption] = useState(initialTable?.caption ?? "");
  const [captionPosition, setCaptionPosition] = useState<TableCaptionPosition>(initialTable?.captionPosition ?? "below");
  const [label, setLabel] = useState(initialTable?.label ?? "");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const hasContent = rows.some((row) => row.some((cell) => cell.trim()));

  const latex = useMemo(() => generateLatexTable({
    rows,
    alignments,
    hasHeader,
    boldHeader,
    boldFirstColumn,
    ruleStyle,
    verticalRules,
    position,
    fontSize,
    rowSpacing,
    floating,
    placement,
    caption,
    captionPosition,
    label,
    cellStyles,
    stripedRows,
    stripeColor,
    ruleColor: customRuleColor ? ruleColor : undefined,
  }), [alignments, boldFirstColumn, boldHeader, caption, captionPosition, cellStyles, customRuleColor, floating, fontSize, hasHeader, label, placement, position, rowSpacing, rows, ruleColor, ruleStyle, stripeColor, stripedRows, verticalRules]);
  const requiredPackages = useMemo(() => getLatexTablePackages({
    rows, cellStyles, stripedRows, ruleColor: customRuleColor ? ruleColor : undefined, ruleStyle,
  }), [cellStyles, customRuleColor, rows, ruleColor, ruleStyle, stripedRows]);
  const selectionBounds = rangeBounds(selection);
  const selectedCellCount = (selectionBounds.lastRow - selectionBounds.firstRow + 1) * (selectionBounds.lastColumn - selectionBounds.firstColumn + 1);
  const selectedStyles = cellStyles.slice(selectionBounds.firstRow, selectionBounds.lastRow + 1)
    .flatMap((row) => row.slice(selectionBounds.firstColumn, selectionBounds.lastColumn + 1));
  const allSelectedBold = selectedStyles.length > 0 && selectedStyles.every((style) => style.bold);
  const allSelectedItalic = selectedStyles.length > 0 && selectedStyles.every((style) => style.italic);
  const allSelectedUnderline = selectedStyles.length > 0 && selectedStyles.every((style) => style.underline);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    setRows((current) => current.map((row, index) => index === rowIndex
      ? row.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell)
      : row));
  };

  const selectCell = (row: number, column: number, extend = false) => {
    setSelection((current) => ({
      start: extend ? current.start : { row, column },
      end: { row, column },
    }));
  };

  const updateSelectedStyles = (update: (style: TableCellStyle) => TableCellStyle) => {
    setCellStyles((current) => current.map((row, rowIndex) => row.map((style, columnIndex) =>
      inRange(selection, rowIndex, columnIndex) ? update(style) : style)));
  };

  const toggleSelectedStyle = (property: "bold" | "italic" | "underline", currentlyApplied: boolean) => {
    updateSelectedStyles((style) => ({ ...style, [property]: currentlyApplied ? undefined : true }));
  };

  const addRow = () => {
    setRows((current) => [...current, Array.from({ length: columnCount }, () => "")]);
    setCellStyles((current) => [...current, Array.from({ length: columnCount }, () => ({}))]);
  };
  const removeRow = (rowIndex: number) => {
    if (rows.length === 1) return;
    setRows((current) => current.filter((_, index) => index !== rowIndex));
    setCellStyles((current) => current.filter((_, index) => index !== rowIndex));
    setSelection({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
  };
  const addColumn = () => {
    setRows((current) => current.map((row) => [...row, ""]));
    setCellStyles((current) => current.map((row) => [...row, {}]));
    setAlignments((current) => [...current, "l"]);
  };
  const removeColumn = (columnIndex: number) => {
    if (columnCount === 1) return;
    setRows((current) => current.map((row) => row.filter((_, index) => index !== columnIndex)));
    setCellStyles((current) => current.map((row) => row.filter((_, index) => index !== columnIndex)));
    setAlignments((current) => current.filter((_, index) => index !== columnIndex));
    setSelection({ start: { row: 0, column: 0 }, end: { row: 0, column: 0 } });
  };

  const pasteIntoCell = (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) => {
    const data = {
      html: event.clipboardData.getData("text/html"),
      text: event.clipboardData.getData("text/plain"),
    };
    const parsed = parseClipboardTable(data);
    const incoming = parsed?.rows ?? (data.text.includes("\t") ? parseDelimitedTable(data.text) : undefined);
    if (!incoming?.length || Math.max(0, ...incoming.map((row) => row.length)) < 2) return;
    event.preventDefault();
    const next = pasteTableCells(rows, incoming, rowIndex, columnIndex);
    setRows(next);
    setCellStyles((current) => parsed?.cellStyles
      ? pasteStyles(current, parsed.cellStyles, next, rowIndex, columnIndex)
      : resizeStyles(current, next));
    setAlignments(inferTableAlignments(next, parsed?.hasHeader ?? hasHeader));
    if (parsed?.hasHeader) setHasHeader(true);
    setSelection({
      start: { row: rowIndex, column: columnIndex },
      end: { row: rowIndex + incoming.length - 1, column: columnIndex + Math.max(...incoming.map((row) => row.length)) - 1 },
    });
  };

  return (
    <div className="table-editor-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="table-editor-panel" role="dialog" aria-modal="true" aria-labelledby="table-editor-title">
        <header className="table-editor-header">
          <div className="table-editor-icon"><Table2 size={17} /></div>
          <div><h2 id="table-editor-title">{initialTable ? "Edit table" : "Insert table"}</h2><p>{initialTable ? "Modify the selected LaTeX table graphically" : "Paste spreadsheet cells or build a table below"}</p></div>
          <button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="Close table editor"><X size={16} /></button>
        </header>

        <div className="table-editor-options">
          <label><input aria-label="Use header row" type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} /> Header row</label>
          <label className={!hasHeader ? "disabled" : ""}><input aria-label="Bold header text" type="checkbox" checked={boldHeader} disabled={!hasHeader} onChange={(event) => setBoldHeader(event.target.checked)} /> Bold header</label>
          <label><input aria-label="Bold first column" type="checkbox" checked={boldFirstColumn} onChange={(event) => setBoldFirstColumn(event.target.checked)} /> Bold first column</label>
          <label>Horizontal lines
            <select aria-label="Horizontal table lines" value={ruleStyle} onChange={(event) => {
              const next = event.target.value as TableRuleStyle;
              setRuleStyle(next);
              if (next === "booktabs") setVerticalRules("none");
            }}>
              <option value="none">None</option>
              <option value="outer">Outer border</option>
              <option value="standard">Outer + header</option>
              <option value="grid">Every row</option>
              <option value="booktabs">Booktabs</option>
            </select>
          </label>
          <label className={ruleStyle === "booktabs" ? "disabled" : ""}>Vertical lines
            <select aria-label="Vertical table lines" value={verticalRules} disabled={ruleStyle === "booktabs"} onChange={(event) => setVerticalRules(event.target.value as TableVerticalRules)}>
              <option value="none">None</option>
              <option value="outer">Outer</option>
              <option value="all">All columns</option>
            </select>
          </label>
          <label>Alignment
            <select aria-label="Table alignment" value={position} onChange={(event) => setPosition(event.target.value as TablePosition)}>
              <option value="default">Default</option>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>Font size
            <select aria-label="Table font size" value={fontSize} onChange={(event) => setFontSize(event.target.value as TableFontSize)}>
              <option value="normal">Normal</option>
              <option value="small">Small</option>
              <option value="footnotesize">Footnote</option>
            </select>
          </label>
          <label>Row spacing
            <select aria-label="Table row spacing" value={rowSpacing} onChange={(event) => setRowSpacing(event.target.value as TableRowSpacing)}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="relaxed">Relaxed</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
          <label><input aria-label="Use floating table" type="checkbox" checked={floating} onChange={(event) => setFloating(event.target.checked)} /> Floating table</label>
          <label className={!floating ? "disabled" : ""}>Placement
            <select aria-label="Floating table placement" value={placement} disabled={!floating} onChange={(event) => setPlacement(event.target.value as TablePlacement)}>
              <option value="htbp">Flexible</option>
              <option value="h">Here</option>
              <option value="t">Page top</option>
              <option value="b">Page bottom</option>
              <option value="p">Float page</option>
            </select>
          </label>
        </div>

        <div className="table-format-toolbar" role="toolbar" aria-label="Cell formatting">
          <span className="table-selection-count">{selectedCellCount} {selectedCellCount === 1 ? "cell" : "cells"} selected</span>
          <div className="table-format-group" aria-label="Text style">
            <button type="button" aria-label="Bold selected cells" aria-pressed={allSelectedBold} onClick={() => toggleSelectedStyle("bold", allSelectedBold)}><Bold size={13} /></button>
            <button type="button" aria-label="Italic selected cells" aria-pressed={allSelectedItalic} onClick={() => toggleSelectedStyle("italic", allSelectedItalic)}><Italic size={13} /></button>
            <button type="button" aria-label="Underline selected cells" aria-pressed={allSelectedUnderline} onClick={() => toggleSelectedStyle("underline", allSelectedUnderline)}><Underline size={13} /></button>
          </div>
          <div className="table-format-group table-colour-control">
            <label>Fill<input aria-label="Cell fill colour" type="color" value={fillPicker} onChange={(event) => {
              setFillPicker(event.target.value);
              updateSelectedStyles((style) => ({ ...style, backgroundColor: event.target.value }));
            }} /></label>
            <button type="button" aria-label="Apply cell fill colour" onClick={() => updateSelectedStyles((style) => ({ ...style, backgroundColor: fillPicker }))}>Apply</button>
            <button type="button" aria-label="Remove cell fill" onClick={() => updateSelectedStyles((style) => ({ ...style, backgroundColor: undefined }))}>No fill</button>
          </div>
          <div className="table-format-group table-colour-control">
            <label>Text<input aria-label="Cell text colour" type="color" value={textPicker} onChange={(event) => {
              setTextPicker(event.target.value);
              updateSelectedStyles((style) => ({ ...style, textColor: event.target.value }));
            }} /></label>
            <button type="button" aria-label="Apply cell text colour" onClick={() => updateSelectedStyles((style) => ({ ...style, textColor: textPicker }))}>Apply</button>
            <button type="button" aria-label="Use automatic text colour" onClick={() => updateSelectedStyles((style) => ({ ...style, textColor: undefined }))}>Auto</button>
          </div>
          <div className="table-format-group" aria-label="Cell alignment">
            {(["l", "c", "r"] as const).map((alignment) => (
              <button type="button" key={alignment} aria-label={`Align selected cells ${alignmentLabel(alignment).toLowerCase()}`} onClick={() => updateSelectedStyles((style) => ({ ...style, alignment }))}>
                <AlignmentIcon alignment={alignment} />
              </button>
            ))}
            <button type="button" aria-label="Use column alignment for selected cells" onClick={() => updateSelectedStyles((style) => ({ ...style, alignment: undefined }))}>Auto</button>
          </div>
          <button type="button" className="table-clear-format" aria-label="Clear selected cell formatting" onClick={() => updateSelectedStyles(() => ({}))}><Eraser size={13} /> Clear</button>
          <div className="table-format-spacer" />
          <label className="table-toolbar-check"><input aria-label="Use banded rows" type="checkbox" checked={stripedRows} onChange={(event) => setStripedRows(event.target.checked)} /> Banded rows</label>
          <label className={`table-colour-compact ${!stripedRows ? "disabled" : ""}`}>Stripe<input aria-label="Stripe colour" type="color" value={stripeColor} disabled={!stripedRows} onChange={(event) => setStripeColor(event.target.value)} /></label>
          <label className="table-toolbar-check"><input aria-label="Use custom rule colour" type="checkbox" checked={customRuleColor} onChange={(event) => setCustomRuleColor(event.target.checked)} /> Coloured rules</label>
          <label className={`table-colour-compact ${!customRuleColor ? "disabled" : ""}`}>Rules<input aria-label="Table rule colour" type="color" value={ruleColor} disabled={!customRuleColor} onChange={(event) => setRuleColor(event.target.value)} /></label>
        </div>

        <div className="table-editor-content">
          <div className="table-grid-area">
            <div className="table-grid-scroll">
              <table className="table-grid">
                <thead>
                  <tr>
                    <th><button type="button" className="table-select-all" aria-label="Select all cells" onClick={() => setSelection({ start: { row: 0, column: 0 }, end: { row: rows.length - 1, column: columnCount - 1 } })} /></th>
                    {Array.from({ length: columnCount }, (_, columnIndex) => (
                      <th key={columnIndex} scope="col">
                        <button type="button" className="table-column-select" aria-label={`Select column ${columnIndex + 1}`} onClick={() => setSelection({ start: { row: 0, column: columnIndex }, end: { row: rows.length - 1, column: columnIndex } })}>Column {columnIndex + 1}</button>
                        <select
                          aria-label={`Column ${columnIndex + 1} alignment`}
                          value={alignments[columnIndex] ?? "l"}
                          onChange={(event) => setAlignments((current) => current.map((alignment, index) =>
                            index === columnIndex ? event.target.value as TableAlignment : alignment))}
                        >
                          {(["l", "c", "r"] as const).map((alignment) => <option key={alignment} value={alignment}>{alignmentLabel(alignment)}</option>)}
                        </select>
                        <span className="alignment-icon" aria-hidden="true"><AlignmentIcon alignment={alignments[columnIndex] ?? "l"} /></span>
                        <button type="button" className="table-remove-column" aria-label={`Remove column ${columnIndex + 1}`} disabled={columnCount === 1} onClick={() => removeColumn(columnIndex)}><X size={11} /></button>
                      </th>
                    ))}
                    <th className="table-grid-add-column"><button type="button" aria-label="Add column" onClick={addColumn}><Plus size={13} /></button></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <th scope="row"><button type="button" aria-label={`Select row ${rowIndex + 1}`} onClick={() => setSelection({ start: { row: rowIndex, column: 0 }, end: { row: rowIndex, column: columnCount - 1 } })}>{rowIndex + 1}</button></th>
                      {Array.from({ length: columnCount }, (_, columnIndex) => (
                        <td key={columnIndex} className={inRange(selection, rowIndex, columnIndex) ? "selected" : ""} style={{
                          backgroundColor: cssColor(cellStyles[rowIndex]?.[columnIndex]?.backgroundColor),
                        }}>
                          <input
                            aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`}
                            value={row[columnIndex] ?? ""}
                            style={{
                              color: cssColor(cellStyles[rowIndex]?.[columnIndex]?.textColor),
                              fontWeight: cellStyles[rowIndex]?.[columnIndex]?.bold ? 700 : undefined,
                              fontStyle: cellStyles[rowIndex]?.[columnIndex]?.italic ? "italic" : undefined,
                              textDecoration: cellStyles[rowIndex]?.[columnIndex]?.underline ? "underline" : undefined,
                              textAlign: cellStyles[rowIndex]?.[columnIndex]?.alignment === "c" ? "center" : cellStyles[rowIndex]?.[columnIndex]?.alignment === "r" ? "right" : "left",
                            }}
                            onMouseDown={(event) => selectCell(rowIndex, columnIndex, event.shiftKey)}
                            onFocus={() => {
                              if (!inRange(selection, rowIndex, columnIndex)) selectCell(rowIndex, columnIndex);
                            }}
                            onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                            onPaste={(event) => pasteIntoCell(event, rowIndex, columnIndex)}
                          />
                        </td>
                      ))}
                      <td className="table-grid-row-action"><button type="button" aria-label={`Remove row ${rowIndex + 1}`} disabled={rows.length === 1} onClick={() => removeRow(rowIndex)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="table-add-row" onClick={addRow}><Plus size={12} /> Add row</button>
            <p>Tip: paste a range copied from Excel, Google Sheets, LibreOffice Calc, or another spreadsheet into any cell.</p>
          </div>

          <aside className="table-preview">
            <h3>LaTeX preview</h3>
            <pre aria-label="LaTeX table preview">{latex}</pre>
            {requiredPackages.length > 0 && <p role="note">Added to the preamble automatically if missing: {requiredPackages.map((entry, index) => <code key={entry}>{index > 0 ? " · " : ""}{entry}</code>)}{ruleStyle === "booktabs" ? ". Vertical lines are omitted." : "."}</p>}
          </aside>
        </div>

        <div className="table-metadata">
          <label>Caption<input aria-label="Table caption" value={caption} disabled={!floating} onChange={(event) => setCaption(event.target.value)} placeholder="Optional caption" /></label>
          <label>Label<input aria-label="Table label" value={label} disabled={!floating} onChange={(event) => setLabel(event.target.value)} placeholder="tab:results" /></label>
          <label>Caption position
            <select aria-label="Table caption position" value={captionPosition} disabled={!floating} onChange={(event) => setCaptionPosition(event.target.value as TableCaptionPosition)}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
        </div>

        <footer className="table-editor-footer">
          <span>{rows.length} {rows.length === 1 ? "row" : "rows"} × {columnCount} {columnCount === 1 ? "column" : "columns"}</span>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="table-insert" disabled={!hasContent || inserting} onClick={() => {
            setInserting(true);
            const result = onInsert(latex, requiredPackages);
            if (result && typeof result.then === "function") {
              void result.finally(() => setInserting(false));
            } else {
              setInserting(false);
            }
          }}>{inserting ? (initialTable ? "Updating…" : "Inserting…") : (initialTable ? "Update table" : "Insert table")}</button>
        </footer>
      </section>
    </div>
  );
}
