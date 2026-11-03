import { describe, expect, it, vi } from "vitest";
import { loadEditorDocument } from "./editorModel";

describe("editor document loading", () => {
  it("replaces the model and places the caret at the start for a different document", () => {
    const setValue = vi.fn();
    const setPosition = vi.fn();
    const editor = {
      getModel: () => ({ getValue: () => "old source", setValue }),
      setPosition,
    };

    expect(loadEditorDocument(editor, "new source")).toBe(true);
    expect(setValue).toHaveBeenCalledWith("new source");
    expect(setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 });
  });

  it("does not touch the model or caret when the document is already current", () => {
    const setValue = vi.fn();
    const setPosition = vi.fn();
    const editor = {
      getModel: () => ({ getValue: () => "current source", setValue }),
      setPosition,
    };

    expect(loadEditorDocument(editor, "current source")).toBe(false);
    expect(setValue).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
  });

  it("is safe while Monaco has no model", () => {
    const setPosition = vi.fn();
    expect(loadEditorDocument({ getModel: () => null, setPosition }, "source")).toBe(false);
    expect(setPosition).not.toHaveBeenCalled();
  });
});
