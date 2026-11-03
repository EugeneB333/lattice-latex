import { describe, expect, it } from "vitest";
import {
  CUSTOM_COMMAND_COUNT,
  customCommandIndexFromKeyboardEvent,
  customCommandSnippet,
  defaultUserCommands,
  userCommandsFromStorage,
} from "./customCommands";

describe("custom commands", () => {
  it("provides exactly twelve empty command slots", () => {
    const commands = defaultUserCommands();
    expect(commands).toHaveLength(CUSTOM_COMMAND_COUNT);
    expect(commands[0]).toEqual({ label: "C1", template: "" });
    expect(commands[11]).toEqual({ label: "C12", template: "" });
  });

  it("restores valid saved commands and fills missing slots", () => {
    const commands = userCommandsFromStorage(JSON.stringify([
      { label: "Theorem", template: "\\begin{theorem}" },
    ]));
    expect(commands).toHaveLength(12);
    expect(commands[0]).toEqual({ label: "Theorem", template: "\\begin{theorem}" });
    expect(commands[1]).toEqual({ label: "C2", template: "" });
  });

  it("falls back safely when saved data is invalid", () => {
    expect(userCommandsFromStorage("not JSON")).toEqual(defaultUserCommands());
    expect(userCommandsFromStorage("{}" )).toEqual(defaultUserCommands());
  });

  it("wraps and safely escapes selected source", () => {
    expect(customCommandSnippet("\\textbf{{{selection}}}", "\\alpha_$x}"))
      .toBe("\\textbf{\\\\alpha_\\$x\\}}");
  });

  it("creates a placeholder without a selection and supports a final cursor", () => {
    expect(customCommandSnippet("\\emph{{{selection}}}{{cursor}}"))
      .toBe("\\emph{${1:text}}$0");
  });

  it("preserves user-authored numbered snippet fields", () => {
    expect(customCommandSnippet("\\frac{${1:a}}{${2:b}}"))
      .toBe("\\frac{${1:a}}{${2:b}}");
  });

  it("maps the complete Shift+F1 through Shift+F12 range", () => {
    for (let number = 1; number <= 12; number += 1) {
      expect(customCommandIndexFromKeyboardEvent({
        key: `F${number}`, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
      })).toBe(number - 1);
    }
    expect(customCommandIndexFromKeyboardEvent({
      key: "F13", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    })).toBeUndefined();
    expect(customCommandIndexFromKeyboardEvent({
      key: "F1", shiftKey: true, ctrlKey: true, altKey: false, metaKey: false,
    })).toBeUndefined();
  });

  it("normalizes malformed slots and enforces storage limits", () => {
    const longLabel = "x".repeat(40);
    const longTemplate = "y".repeat(10_100);
    const commands = userCommandsFromStorage(JSON.stringify([
      { label: longLabel, template: longTemplate },
      null,
      { label: 3, template: false },
    ]));
    expect(commands[0].label).toHaveLength(32);
    expect(commands[0].template).toHaveLength(10_000);
    expect(commands[1]).toEqual({ label: "C2", template: "" });
    expect(commands[2]).toEqual({ label: "C3", template: "" });
  });

  it("replaces every selection and cursor token", () => {
    expect(customCommandSnippet("{{selection}} + {{selection}}{{cursor}}{{cursor}}", "x"))
      .toBe("x + x$0$0");
  });

  it("leaves ordinary templates untouched", () => {
    expect(customCommandSnippet("\\LaTeX")).toBe("\\LaTeX");
  });

  it("rejects missing Shift and every conflicting modifier", () => {
    for (const overrides of [
      { shiftKey: false }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    ]) {
      expect(customCommandIndexFromKeyboardEvent({
        key: "F1", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, ...overrides,
      })).toBeUndefined();
    }
  });
});
