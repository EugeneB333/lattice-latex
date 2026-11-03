import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDINGS, hotkeyFromEvent, keybindingsFromStorage } from "./keybindings";

describe("hotkeyFromEvent", () => {
  it("normalises letters and modifiers", () => {
    expect(hotkeyFromEvent({ key: "d", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+D");
    expect(hotkeyFromEvent({ key: "F1", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe("F1");
  });

  it("waits when only a modifier is pressed", () => {
    expect(hotkeyFromEvent({ key: "Control", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBeUndefined();
  });

  it("normalizes spaces, punctuation, long keys, and modifier order", () => {
    expect(hotkeyFromEvent({ key: " ", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })).toBe("Ctrl+Alt+Shift+Meta+Space");
    expect(hotkeyFromEvent({ key: "/", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBe("Shift+/");
    expect(hotkeyFromEvent({ key: "ArrowUp", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe("ArrowUp");
  });
});

describe("keybindingsFromStorage", () => {
  it("uses defaults for absent or malformed settings", () => {
    expect(keybindingsFromStorage(null)).toEqual(DEFAULT_KEYBINDINGS);
    expect(keybindingsFromStorage("not json")).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("merges valid saved bindings with defaults", () => {
    expect(keybindingsFromStorage('{"build":"Ctrl+B"}')).toEqual({ ...DEFAULT_KEYBINDINGS, build: "Ctrl+B" });
  });

  it("rejects empty and non-string saved bindings individually", () => {
    expect(keybindingsFromStorage('{"build":"","deleteLine":3,"toggleComment":"Alt+M"}')).toEqual({
      build: DEFAULT_KEYBINDINGS.build,
      deleteLine: DEFAULT_KEYBINDINGS.deleteLine,
      toggleComment: "Alt+M",
    });
  });

  it("returns new default objects instead of a shared mutable singleton", () => {
    expect(keybindingsFromStorage(null)).not.toBe(DEFAULT_KEYBINDINGS);
    expect(keybindingsFromStorage(null)).not.toBe(keybindingsFromStorage(null));
  });
});
