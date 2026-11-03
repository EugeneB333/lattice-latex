import { describe, expect, it, vi } from "vitest";
import { registerScriptBraces } from "./scriptBraces";

class Selection {
  constructor(public startLineNumber: number, public startColumn: number, public endLineNumber = startLineNumber, public endColumn = startColumn) {}
  getStartPosition() { return { lineNumber: this.startLineNumber, column: this.startColumn }; }
  getEndPosition() { return { lineNumber: this.endLineNumber, column: this.endColumn }; }
}

function setup(initial: string, initialSelections = [new Selection(1, initial.length + 1)]) {
  let value = initial;
  let selections: Selection[] | null = initialSelections;
  let handler: (event: ReturnType<typeof keyEvent>) => void;
  const dispose = vi.fn();
  const offsetAt = ({ lineNumber, column }: { lineNumber: number; column: number }) =>
    value.split("\n").slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1;
  const model = {
    getLanguageId: vi.fn(() => "latex"),
    getLineContent: (line: number) => value.split("\n")[line - 1],
    getOffsetAt: offsetAt,
    getPositionAt: (offset: number) => {
      const lines = value.slice(0, offset).split("\n");
      return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 };
    },
  };
  const target = {
    onKeyDown: vi.fn((callback: typeof handler) => { handler = callback; return { dispose }; }),
    getModel: vi.fn((): typeof model | null => model),
    getSelections: vi.fn(() => selections),
    getOption: vi.fn(() => false),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn((_source: string, edits: { range: Selection; text: string }[], cursorState: () => Selection[]) => {
      const replacements = edits.map(({ range, text }) => ({ start: offsetAt(range.getStartPosition()), end: offsetAt(range.getEndPosition()), text }));
      for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
        value = value.slice(0, start) + text + value.slice(end);
      }
      selections = cursorState();
      return true;
    }),
  };
  const registration = registerScriptBraces(target as never, { Selection, editor: { EditorOption: { readOnly: 91 } } } as never);
  return { target, model, registration, dispose, value: () => value, selections: () => selections, fire: (event: ReturnType<typeof keyEvent>) => handler(event) };
}

function keyEvent(key: string, overrides = {}) {
  return { browserEvent: { key, isComposing: false }, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides };
}

describe("typed LaTeX script braces", () => {
  describe.each(["_", "^"])("%s", (key) => {
    it.each(["", "x", "$x", "\\\\", "\\% x", "a😀"])("inserts braces after %s with the caret inside", (prefix) => {
      const h = setup(prefix);
      const event = keyEvent(key);
      h.fire(event);
      expect(h.value()).toBe(`${prefix}${key}{}`);
      expect(h.selections()).toEqual([new Selection(1, prefix.length + 3)]);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).toHaveBeenCalledOnce();
      expect(h.target.pushUndoStop).toHaveBeenCalledTimes(2);
      expect(h.target.pushUndoStop.mock.invocationCallOrder[0]).toBeLessThan(h.target.executeEdits.mock.invocationCallOrder[0]);
      expect(h.target.pushUndoStop.mock.invocationCallOrder[1]).toBeGreaterThan(h.target.executeEdits.mock.invocationCallOrder[0]);
    });

    it.each(["\\", "\\\\\\", "% comment", "text % comment", "\\\\% comment"])("leaves escaped/comment text %s to normal typing", (prefix) => {
      const h = setup(prefix);
      const event = keyEvent(key);
      h.fire(event);
      expect(h.target.executeEdits).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("does not duplicate an existing opening brace", () => {
      const h = setup("x{2}", [new Selection(1, 2)]);
      h.fire(keyEvent(key));
      expect(h.target.executeEdits).not.toHaveBeenCalled();
    });

    it("inserts in the middle without overwriting following content", () => {
      const h = setup("$xy$", [new Selection(1, 3)]);
      h.fire(keyEvent(key));
      expect(h.value()).toBe(`$x${key}{}y$`);
      expect(h.selections()).toEqual([new Selection(1, 5)]);
    });

    it("replaces a selection, including multiple lines", () => {
      const h = setup("xabc\ndefz", [new Selection(1, 2, 2, 4)]);
      h.fire(keyEvent(key));
      expect(h.value()).toBe(`x${key}{}z`);
      expect(h.selections()).toEqual([new Selection(1, 4)]);
    });

    it("preserves primary cursor order and adjusts multiple cursors on one line", () => {
      const h = setup("x y", [new Selection(1, 4), new Selection(1, 2)]);
      h.fire(keyEvent(key));
      expect(h.value()).toBe(`x${key}{} y${key}{}`);
      expect(h.selections()).toEqual([new Selection(1, 9), new Selection(1, 4)]);
    });

    it("handles mixed normal, escaped, comment, and already-braced cursors", () => {
      const h = setup("x\n\\\n% comment\ny{2}", [new Selection(1, 2), new Selection(2, 2), new Selection(3, 10), new Selection(4, 2)]);
      h.fire(keyEvent(key));
      expect(h.value()).toBe(`x${key}{}\n\\${key}\n% comment${key}\ny${key}{2}`);
      expect(h.selections()).toEqual([new Selection(1, 4), new Selection(2, 3), new Selection(3, 11), new Selection(4, 3)]);
    });

    it.each(["bibtex", "plaintext"])("does not change %s documents", (language) => {
      const h = setup("x");
      h.model.getLanguageId.mockReturnValue(language);
      h.fire(keyEvent(key));
      expect(h.target.executeEdits).not.toHaveBeenCalled();
    });

    it.each(["ctrlKey", "metaKey", "altKey"])("preserves %s shortcuts", (modifier) => {
      const h = setup("x");
      h.fire(keyEvent(key, { [modifier]: true }));
      expect(h.target.executeEdits).not.toHaveBeenCalled();
    });

    it("does not interfere with IME composition or read-only editors", () => {
      const h = setup("x");
      h.fire(keyEvent(key, { browserEvent: { key, isComposing: true } }));
      h.target.getOption.mockReturnValue(true);
      h.fire(keyEvent(key));
      expect(h.target.executeEdits).not.toHaveBeenCalled();
    });

    it("tolerates missing models and selections", () => {
      const h = setup("x");
      h.target.getModel.mockReturnValue(null);
      h.fire(keyEvent(key));
      h.target.getModel.mockReturnValue(h.model);
      h.target.getSelections.mockReturnValue(null);
      h.fire(keyEvent(key));
      h.target.getSelections.mockReturnValue([]);
      h.fire(keyEvent(key));
      expect(h.target.executeEdits).not.toHaveBeenCalled();
    });
  });

  it.each(["a", "{", "ArrowRight", "Dead", "Process", "_{}", ""])("ignores non-operator key %s", (key) => {
    const h = setup("x");
    h.fire(keyEvent(key));
    expect(h.target.executeEdits).not.toHaveBeenCalled();
  });

  it("does not modify loaded content and exposes listener disposal", () => {
    const h = setup("x_i + y^2");
    expect(h.value()).toBe("x_i + y^2");
    expect(h.target.executeEdits).not.toHaveBeenCalled();
    h.registration.dispose();
    expect(h.dispose).toHaveBeenCalledOnce();
  });
});
