// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableEditor } from "./TableEditor";
import { change, cleanupRoots, click, keydown, render } from "./test/render";

const roots: Array<{ unmount: () => void }> = [];

afterEach(() => {
  cleanupRoots(roots);
  document.body.innerHTML = "";
});

function viewEditor(onInsert = vi.fn(), onClose = vi.fn()) {
  const view = render(<TableEditor onInsert={onInsert} onClose={onClose} />);
  roots.push(view);
  return { ...view, onInsert, onClose };
}

function input(container: ParentNode, label: string) {
  return container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
}

describe("TableEditor", () => {
  it("renders an accessible empty grid and blocks empty insertion", () => {
    const { container } = viewEditor();
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelectorAll(".table-grid tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll(".table-grid tbody input")).toHaveLength(9);
    expect((container.querySelector(".table-insert") as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Table caption"]') as HTMLInputElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Floating table placement"]') as HTMLSelectElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Table caption position"]') as HTMLSelectElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Vertical table lines"]') as HTMLSelectElement).disabled).toBe(false);
    expect(input(container, "Bold header text").disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLOptionElement>('[aria-label="Horizontal table lines"] option')].map((option) => option.textContent)).toEqual([
      "None", "Outer border", "Outer + header", "Every row", "Booktabs",
    ]);
    expect(container.querySelector('[aria-label="Cell formatting"]')).not.toBeNull();
    expect(container.querySelector(".table-selection-count")?.textContent).toContain("1 cell selected");
    expect(container.querySelector('[aria-label="LaTeX table preview"]')?.textContent).toContain("\\begin{tabular}{lll}");
  });

  it("formats a cell range with font styles, fill, text colour, and cell alignment", () => {
    const { container, onInsert } = viewEditor();
    change(input(container, "Row 1, column 1"), "Total");
    change(input(container, "Row 1, column 2"), "4");
    act(() => input(container, "Row 1, column 2").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, shiftKey: true })));
    expect(container.querySelector(".table-selection-count")?.textContent).toContain("2 cells selected");

    click(container.querySelector('[aria-label="Bold selected cells"]')!);
    click(container.querySelector('[aria-label="Italic selected cells"]')!);
    click(container.querySelector('[aria-label="Underline selected cells"]')!);
    change(input(container, "Cell fill colour"), "#fff2cc");
    click(container.querySelector('[aria-label="Apply cell fill colour"]')!);
    change(input(container, "Cell text colour"), "#c00000");
    click(container.querySelector('[aria-label="Apply cell text colour"]')!);
    click(container.querySelector('[aria-label="Align selected cells centre"]')!);

    expect(input(container, "Row 1, column 1").closest("td")?.style.backgroundColor).toBe("rgb(255, 242, 204)");
    expect(input(container, "Row 1, column 1").style.fontWeight).toBe("700");
    const preview = container.querySelector('[aria-label="LaTeX table preview"]')?.textContent ?? "";
    expect(preview).toContain("\\cellcolor[HTML]{FFF2CC}");
    expect(preview).toContain("\\textcolor[HTML]{C00000}");
    expect(preview).toContain("\\multicolumn{1}{c}");
    expect(container.querySelector('[role="note"]')?.textContent).toContain("Added to the preamble automatically if missing");
    expect(container.querySelector('[role="note"]')?.textContent).toContain("\\usepackage[table]{xcolor}");

    click(container.querySelector(".table-insert")!);
    expect(onInsert.mock.calls[0][0]).toBe(preview);
    expect(onInsert.mock.calls[0][1]).toEqual(["\\usepackage[table]{xcolor}"]);
  });

  it("selects rows, columns, and all cells; clears formatting; and configures banding and rule colours", () => {
    const { container } = viewEditor();
    change(input(container, "Row 1, column 1"), "A");
    click(container.querySelector('[aria-label="Select row 2"]')!);
    expect(container.querySelector(".table-selection-count")?.textContent).toContain("3 cells selected");
    click(container.querySelector('[aria-label="Bold selected cells"]')!);
    expect(container.querySelectorAll(".table-grid tbody td.selected")).toHaveLength(3);

    click(container.querySelector('[aria-label="Select column 1"]')!);
    expect(container.querySelectorAll(".table-grid tbody td.selected")).toHaveLength(3);
    click(container.querySelector('[aria-label="Select all cells"]')!);
    expect(container.querySelectorAll(".table-grid tbody td.selected")).toHaveLength(9);
    click(container.querySelector('[aria-label="Clear selected cell formatting"]')!);
    expect(container.querySelector('[aria-label="LaTeX table preview"]')?.textContent).not.toContain("\\textbf{");

    click(input(container, "Use banded rows"));
    change(input(container, "Stripe colour"), "#ddebf7");
    click(input(container, "Use custom rule colour"));
    change(input(container, "Table rule colour"), "#4472c4");
    const preview = container.querySelector('[aria-label="LaTeX table preview"]')?.textContent ?? "";
    expect(preview).toContain("\\rowcolor[HTML]{DDEBF7}");
    expect(preview).toContain("\\arrayrulecolor[HTML]{4472C4}");
    expect(container.querySelector('[role="note"]')?.textContent).toContain("xcolor");
  });

  it("edits cells, alignments, headings, rules, floating metadata, and inserts the preview", () => {
    const { container, onInsert } = viewEditor();
    change(input(container, "Row 1, column 1"), "Item & type");
    change(input(container, "Row 1, column 2"), "Price");
    change(input(container, "Row 2, column 1"), "Apple");
    change(input(container, "Row 2, column 2"), "$2");
    click(input(container, "Use header row"));
    change(container.querySelector('[aria-label="Column 2 alignment"]') as HTMLSelectElement, "r");
    change(container.querySelector('[aria-label="Horizontal table lines"]') as HTMLSelectElement, "booktabs");
    click(input(container, "Use floating table"));
    change(input(container, "Table caption"), "Costs & revenue");
    change(input(container, "Table label"), "tab:costs");

    expect(container.querySelector('[role="note"]')?.textContent).toContain("booktabs");
    click(container.querySelector(".table-insert")!);
    expect(onInsert).toHaveBeenCalledOnce();
    const latex = onInsert.mock.calls[0][0];
    expect(latex).toContain("\\begin{table}[htbp]");
    expect(latex).toContain("\\begin{tabular}{lrl}");
    expect(latex).toContain("\\textbf{Item \\& type}");
    expect(latex).toContain("\\$2");
    expect(latex).toContain("\\caption{Costs \\& revenue}");
  });

  it("applies borders, positioning, typography, row spacing, first-column emphasis, placement, and caption position", () => {
    const { container, onInsert } = viewEditor();
    change(input(container, "Row 1, column 1"), "Item");
    change(input(container, "Row 1, column 2"), "Value");
    click(input(container, "Bold first column"));
    change(container.querySelector('[aria-label="Horizontal table lines"]') as HTMLSelectElement, "grid");
    change(container.querySelector('[aria-label="Vertical table lines"]') as HTMLSelectElement, "all");
    change(container.querySelector('[aria-label="Table alignment"]') as HTMLSelectElement, "right");
    change(container.querySelector('[aria-label="Table font size"]') as HTMLSelectElement, "small");
    change(container.querySelector('[aria-label="Table row spacing"]') as HTMLSelectElement, "relaxed");
    click(input(container, "Use floating table"));
    change(container.querySelector('[aria-label="Floating table placement"]') as HTMLSelectElement, "t");
    change(input(container, "Table caption"), "Summary");
    change(container.querySelector('[aria-label="Table caption position"]') as HTMLSelectElement, "above");

    click(container.querySelector(".table-insert")!);
    const latex = onInsert.mock.calls[0][0];
    expect(latex).toContain("\\begin{table}[t]\n  \\raggedleft\n  \\caption{Summary}");
    expect(latex).toContain("\\small");
    expect(latex).toContain("\\renewcommand{\\arraystretch}{1.25}");
    expect(latex).toContain("\\begin{tabular}{|l|l|l|}");
    expect(latex).toContain("\\textbf{Item} & Value");
  });

  it("disables and clears vertical rules for booktabs", () => {
    const { container } = viewEditor();
    const vertical = container.querySelector('[aria-label="Vertical table lines"]') as HTMLSelectElement;
    change(vertical, "all");
    change(container.querySelector('[aria-label="Horizontal table lines"]') as HTMLSelectElement, "booktabs");
    expect(vertical.disabled).toBe(true);
    expect(vertical.value).toBe("none");
    expect(container.querySelector('[role="note"]')?.textContent).toContain("Vertical lines are omitted");
    expect(container.querySelector('[aria-label="LaTeX table preview"]')?.textContent).toContain("\\begin{tabular}{lll}");
  });

  it("adds and removes rows and columns while preserving the one-cell minimum", () => {
    const { container } = viewEditor();
    click(container.querySelector('[aria-label="Add column"]')!);
    click([...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Add row"))!);
    expect(container.querySelectorAll(".table-grid tbody input")).toHaveLength(16);
    click(container.querySelector('[aria-label="Remove column 2"]')!);
    click(container.querySelector('[aria-label="Remove row 2"]')!);
    expect(container.querySelectorAll(".table-grid tbody input")).toHaveLength(9);

    for (let column = 3; column >= 2; column -= 1) click(container.querySelector(`[aria-label="Remove column ${column}"]`)!);
    for (let row = 3; row >= 2; row -= 1) click(container.querySelector(`[aria-label="Remove row ${row}"]`)!);
    expect((container.querySelector('[aria-label="Remove column 1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[aria-label="Remove row 1"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("pastes spreadsheet cells at the selected location, expands the grid, and infers formatting", () => {
    const { container } = viewEditor();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "Name\tCount\nAda\t4\nLin\t8" : "" } });
    act(() => input(container, "Row 2, column 2").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input(container, "Row 2, column 2").value).toBe("Name");
    expect(input(container, "Row 4, column 3").value).toBe("8");
    expect((container.querySelector('[aria-label="Column 3 alignment"]') as HTMLSelectElement).value).toBe("r");
  });

  it("preserves fill, text, font, and alignment formatting from rich spreadsheet paste", () => {
    const { container } = viewEditor();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/html"
      ? '<table><tr><td style="background-color:#fff2cc;color:#c00000;font-weight:bold;text-align:center">Total</td><td>4</td></tr><tr><td>Other</td><td>2</td></tr></table>'
      : "Total\t4\nOther\t2" } });
    act(() => input(container, "Row 1, column 1").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(input(container, "Row 1, column 1").closest("td")?.style.backgroundColor).toBe("rgb(255, 242, 204)");
    const preview = container.querySelector('[aria-label="LaTeX table preview"]')?.textContent ?? "";
    expect(preview).toContain("\\cellcolor[HTML]{FFF2CC}");
    expect(preview).toContain("\\textcolor[HTML]{C00000}");
    expect(preview).toContain("\\multicolumn{1}{c}");
  });

  it("does not consume ordinary cell paste and closes from every affordance", () => {
    const { container, onClose } = viewEditor();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "ordinary text" : "" } });
    input(container, "Row 1, column 1").dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);

    click(container.querySelector('[aria-label="Close table editor"]')!);
    keydown(window, "Escape");
    container.querySelector(".table-editor-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    click([...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("prevents duplicate insertion while automatic preamble work is pending", async () => {
    let finish: (() => void) | undefined;
    const onInsert = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { container } = viewEditor(onInsert);
    change(input(container, "Row 1, column 1"), "Result");
    click(container.querySelector(".table-insert")!);
    expect((container.querySelector(".table-insert") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector(".table-insert")?.textContent).toBe("Inserting…");
    click(container.querySelector(".table-insert")!);
    expect(onInsert).toHaveBeenCalledOnce();
    await act(async () => finish?.());
    expect((container.querySelector(".table-insert") as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector(".table-insert")?.textContent).toBe("Insert table");
  });

  it("opens in edit mode with parsed content and formatting, then submits an updated table", () => {
    const onInsert = vi.fn();
    const view = render(<TableEditor
      onClose={vi.fn()}
      onInsert={onInsert}
      initialTable={{
        rows: [["Name", "Count"], ["Ada", "4"]],
        alignments: ["l", "r"],
        hasHeader: true,
        boldHeader: false,
        ruleStyle: "booktabs",
        floating: true,
        placement: "t",
        caption: "Results",
        label: "tab:results",
        cellStyles: [[{}, {}], [{ backgroundColor: "FFF2CC", italic: true }, {}]],
      }}
    />);
    roots.push(view);
    expect(view.container.querySelector("#table-editor-title")?.textContent).toBe("Edit table");
    expect(input(view.container, "Row 1, column 1").value).toBe("Name");
    expect((view.container.querySelector('[aria-label="Column 2 alignment"]') as HTMLSelectElement).value).toBe("r");
    expect(input(view.container, "Use header row").checked).toBe(true);
    expect(input(view.container, "Bold header text").checked).toBe(false);
    expect(input(view.container, "Use floating table").checked).toBe(true);
    expect(input(view.container, "Table caption").value).toBe("Results");
    expect(input(view.container, "Row 2, column 1").closest("td")?.style.backgroundColor).toBe("rgb(255, 242, 204)");
    expect(view.container.querySelector(".table-insert")?.textContent).toBe("Update table");

    change(input(view.container, "Row 2, column 2"), "5");
    click(view.container.querySelector(".table-insert")!);
    expect(onInsert.mock.calls[0][0]).toContain("\\textit{Ada} & 5");
    expect(onInsert.mock.calls[0][1]).toEqual(["\\usepackage[table]{xcolor}", "\\usepackage{booktabs}"]);
  });
});
