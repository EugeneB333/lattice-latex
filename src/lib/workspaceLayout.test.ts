import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  dockZone,
  moveWorkspacePane,
  resizeDock,
  resizeDockSplit,
  workspaceLayoutFromStorage,
} from "./workspaceLayout";

describe("workspace layout", () => {
  it("provides an isolated default layout for empty and malformed storage", () => {
    const empty = workspaceLayoutFromStorage(null);
    const malformed = workspaceLayoutFromStorage("not-json");
    expect(empty).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(malformed).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    empty.sizes.left = 500;
    expect(workspaceLayoutFromStorage(null).sizes.left).toBe(210);
  });

  it("restores valid placements and clamps every persisted dimension", () => {
    expect(workspaceLayoutFromStorage(JSON.stringify({
      placements: { navigator: "bottom-left", editor: "center-right", preview: "left-bottom", ai: "right-top" },
      sizes: { left: 10, right: 900, bottom: 300 },
      splits: { left: 5, center: 33, right: 95, bottom: 64 },
    }))).toEqual({
      placements: { navigator: "bottom-left", editor: "center-right", preview: "left-bottom", ai: "right-top" },
      sizes: { left: 190, right: 640, bottom: 300 },
      splits: { left: 20, center: 33, right: 80, bottom: 64 },
    });
  });

  it("migrates saved three-pane layouts by placing the editor in the free default centre slot", () => {
    expect(workspaceLayoutFromStorage(JSON.stringify({
      placements: { navigator: "bottom-left", preview: "left-bottom", ai: "right-top" },
      sizes: { left: 240, right: 420, bottom: 280 },
      splits: { left: 40, right: 60, bottom: 55 },
    }))).toEqual({
      placements: { navigator: "bottom-left", editor: "center-left", preview: "left-bottom", ai: "right-top" },
      sizes: { left: 240, right: 420, bottom: 280 },
      splits: { left: 40, center: 50, right: 60, bottom: 55 },
    });
  });

  it.each([
    { placements: { navigator: "left-top", editor: "center-left", preview: "left-top", ai: "right-top" } },
    { placements: { navigator: "floating", editor: "center-left", preview: "right-top", ai: "right-bottom" } },
    { placements: { navigator: "left-top", editor: "center-left", preview: "right-top" } },
  ])("rejects invalid or colliding placements", (stored) => {
    expect(workspaceLayoutFromStorage(JSON.stringify(stored))).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });

  it("moves into free slots and swaps panes when the target is occupied", () => {
    const moved = moveWorkspacePane(DEFAULT_WORKSPACE_LAYOUT, "navigator", "bottom-left");
    expect(moved.placements).toEqual({ navigator: "bottom-left", editor: "center-left", preview: "right-top", ai: "right-bottom" });
    const swapped = moveWorkspacePane(DEFAULT_WORKSPACE_LAYOUT, "navigator", "right-bottom");
    expect(swapped.placements).toEqual({ navigator: "right-bottom", editor: "center-left", preview: "right-top", ai: "left-top" });
    const editorMoved = moveWorkspacePane(DEFAULT_WORKSPACE_LAYOUT, "editor", "center-right");
    expect(editorMoved.placements.editor).toBe("center-right");
    expect(moveWorkspacePane(DEFAULT_WORKSPACE_LAYOUT, "navigator", "left-top")).toBe(DEFAULT_WORKSPACE_LAYOUT);
  });

  it("clamps interactive dock and split resizing without mutating the previous layout", () => {
    const wider = resizeDock(DEFAULT_WORKSPACE_LAYOUT, "left", 999);
    const split = resizeDockSplit(DEFAULT_WORKSPACE_LAYOUT, "right", -1);
    const centreSplit = resizeDockSplit(DEFAULT_WORKSPACE_LAYOUT, "center", 62);
    expect(wider.sizes.left).toBe(520);
    expect(split.splits.right).toBe(20);
    expect(centreSplit.splits.center).toBe(62);
    expect(DEFAULT_WORKSPACE_LAYOUT.sizes.left).toBe(210);
    expect(DEFAULT_WORKSPACE_LAYOUT.splits.right).toBe(56);
  });

  it.each([
    ["left-bottom", "left"],
    ["center-right", "center"],
    ["right-top", "right"],
    ["bottom-right", "bottom"],
  ] as const)("maps %s to its dock zone", (slot, zone) => {
    expect(dockZone(slot)).toBe(zone);
  });
});
