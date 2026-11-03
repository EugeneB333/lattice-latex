// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  initialBuildMode,
  initialCustomCommands,
  initialCustomToolbarEnabled,
  initialCustomToolbarPosition,
  initialFont,
  initialFontSize,
  initialKeybindings,
  initialMathToolbarEnabled,
  initialMathToolbarPosition,
  initialSpellcheckDialect,
  initialSpellcheckEnabled,
  initialTheme,
  initialWorkspaceLayout,
} from "./App";
import { defaultUserCommands } from "./customCommands";
import { DEFAULT_KEYBINDINGS } from "./lib/keybindings";
import { DEFAULT_WORKSPACE_LAYOUT } from "./lib/workspaceLayout";

describe("saved application settings", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses every documented default when storage is empty", () => {
    expect(initialTheme()).toBe("lattice");
    expect(initialFont()).toBe("jetbrains");
    expect(initialFontSize()).toBe(13.5);
    expect(initialMathToolbarEnabled()).toBe(true);
    expect(initialMathToolbarPosition()).toBe("top");
    expect(initialCustomToolbarEnabled()).toBe(true);
    expect(initialCustomToolbarPosition()).toBe("top");
    expect(initialBuildMode()).toBe("on-demand");
    expect(initialSpellcheckEnabled()).toBe(true);
    expect(initialSpellcheckDialect()).toBe("british");
    expect(initialKeybindings()).toEqual(DEFAULT_KEYBINDINGS);
    expect(initialCustomCommands()).toEqual(defaultUserCommands());
    expect(initialWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });

  it.each([
    ["lattice-theme", "paper", initialTheme, "paper"],
    ["lattice-editor-font", "source-code", initialFont, "source-code"],
    ["lattice-math-toolbar-position", "bottom", initialMathToolbarPosition, "bottom"],
    ["lattice-math-toolbar-position", "left", initialMathToolbarPosition, "left"],
    ["lattice-math-toolbar-position", "right", initialMathToolbarPosition, "right"],
    ["lattice-custom-toolbar-position", "bottom", initialCustomToolbarPosition, "bottom"],
    ["lattice-custom-toolbar-position", "left", initialCustomToolbarPosition, "left"],
    ["lattice-custom-toolbar-position", "right", initialCustomToolbarPosition, "right"],
    ["lattice-build-mode", "live", initialBuildMode, "live"],
    ["lattice-spellcheck-dialect", "american", initialSpellcheckDialect, "american"],
    ["lattice-spellcheck-dialect", "australian", initialSpellcheckDialect, "australian"],
    ["lattice-spellcheck-dialect", "canadian", initialSpellcheckDialect, "canadian"],
    ["lattice-spellcheck-dialect", "indian", initialSpellcheckDialect, "indian"],
  ])("restores valid %s values", (key, value, read, expected) => {
    window.localStorage.setItem(key, value);
    expect(read()).toBe(expected);
  });

  it.each([
    ["lattice-theme", "unknown", initialTheme, "lattice"],
    ["lattice-editor-font", "comic-sans", initialFont, "jetbrains"],
    ["lattice-math-toolbar-position", "diagonal", initialMathToolbarPosition, "top"],
    ["lattice-custom-toolbar-position", "diagonal", initialCustomToolbarPosition, "top"],
    ["lattice-build-mode", "continuous", initialBuildMode, "on-demand"],
    ["lattice-spellcheck-dialect", "martian", initialSpellcheckDialect, "british"],
  ])("rejects unsupported %s values", (key, value, read, expected) => {
    window.localStorage.setItem(key, value);
    expect(read()).toBe(expected);
  });

  it.each([
    ["11", 11],
    ["13.75", 13.75],
    ["22", 22],
    ["10.99", 13.5],
    ["22.01", 13.5],
    ["not-a-number", 13.5],
  ])("validates the persisted font size %s", (stored, expected) => {
    window.localStorage.setItem("lattice-editor-font-size", stored);
    expect(initialFontSize()).toBe(expected);
  });

  it("only treats the exact string false as a disabled toggle", () => {
    for (const [key, read] of [
      ["lattice-math-toolbar-enabled", initialMathToolbarEnabled],
      ["lattice-custom-toolbar-enabled", initialCustomToolbarEnabled],
      ["lattice-spellcheck-enabled", initialSpellcheckEnabled],
    ] as const) {
      window.localStorage.setItem(key, "false");
      expect(read()).toBe(false);
      window.localStorage.setItem(key, "true");
      expect(read()).toBe(true);
      window.localStorage.setItem(key, "invalid");
      expect(read()).toBe(true);
    }
  });

  it("restores valid keybindings and custom commands through their sanitizers", () => {
    window.localStorage.setItem("lattice-keybindings", JSON.stringify({ build: "F8" }));
    window.localStorage.setItem("lattice-custom-commands", JSON.stringify([
      { label: "Lemma", template: "\\begin{lemma}" },
    ]));
    expect(initialKeybindings()).toEqual({ ...DEFAULT_KEYBINDINGS, build: "F8" });
    expect(initialCustomCommands()[0]).toEqual({ label: "Lemma", template: "\\begin{lemma}" });
    expect(initialCustomCommands()).toHaveLength(12);
  });
});
