import { describe, expect, it, vi } from "vitest";
import { insertEditorText } from "./editorInsertion";

function editor(model: unknown | null, selection: { line: number } | null) {
  return {
    getModel: vi.fn(() => model),
    getSelection: vi.fn(() => selection),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn(),
    focus: vi.fn(),
  };
}

describe("insertEditorText", () => {
  it("performs one focused edit between undo stops", () => {
    const selection = { line: 2 };
    const target = editor({}, selection);
    expect(insertEditorText(target, "table", "spreadsheet-paste")).toBe(true);
    expect(target.executeEdits).toHaveBeenCalledWith("spreadsheet-paste", [{ range: selection, text: "table", forceMoveMarkers: true }]);
    expect(target.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("does nothing while either the model or selection is unavailable", () => {
    const withoutModel = editor(null, { line: 1 });
    const withoutSelection = editor({}, null);
    expect(insertEditorText(withoutModel, "table", "test")).toBe(false);
    expect(insertEditorText(withoutSelection, "table", "test")).toBe(false);
    expect(withoutModel.executeEdits).not.toHaveBeenCalled();
    expect(withoutSelection.executeEdits).not.toHaveBeenCalled();
  });
});
