export const WORKSPACE_PANES = ["navigator", "editor", "preview", "ai"] as const;
export type WorkspacePaneId = (typeof WORKSPACE_PANES)[number];

export const DOCK_SLOTS = [
  "left-top",
  "left-bottom",
  "center-left",
  "center-right",
  "right-top",
  "right-bottom",
  "bottom-left",
  "bottom-right",
] as const;
export type DockSlot = (typeof DOCK_SLOTS)[number];
export type DockZone = "left" | "center" | "right" | "bottom";
export type DockSizeZone = Exclude<DockZone, "center">;

export interface WorkspaceLayout {
  placements: Record<WorkspacePaneId, DockSlot>;
  sizes: Record<DockSizeZone, number>;
  splits: Record<DockZone, number>;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  placements: {
    navigator: "left-top",
    editor: "center-left",
    preview: "right-top",
    ai: "right-bottom",
  },
  sizes: {
    left: 210,
    right: 390,
    bottom: 260,
  },
  splits: {
    left: 50,
    center: 50,
    right: 56,
    bottom: 50,
  },
};

export const DOCK_SIZE_LIMITS: Record<DockSizeZone, readonly [number, number]> = {
  left: [190, 520],
  right: [300, 640],
  bottom: [160, 520],
};

export const SPLIT_LIMITS = [20, 80] as const;

function copyDefaultLayout(): WorkspaceLayout {
  return {
    placements: { ...DEFAULT_WORKSPACE_LAYOUT.placements },
    sizes: { ...DEFAULT_WORKSPACE_LAYOUT.sizes },
    splits: { ...DEFAULT_WORKSPACE_LAYOUT.splits },
  };
}

function clamp(value: number, [minimum, maximum]: readonly [number, number]) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function dockZone(slot: DockSlot): DockZone {
  if (slot.startsWith("left-")) return "left";
  if (slot.startsWith("center-")) return "center";
  if (slot.startsWith("right-")) return "right";
  return "bottom";
}

export function workspaceLayoutFromStorage(raw: string | null): WorkspaceLayout {
  if (!raw) return copyDefaultLayout();
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    const storedPlacements = parsed.placements;
    const legacyPlacements = storedPlacements
      && storedPlacements.editor === undefined
      && (["navigator", "preview", "ai"] as const).every((pane) => DOCK_SLOTS.includes(storedPlacements[pane] as DockSlot))
      ? { ...storedPlacements, editor: DEFAULT_WORKSPACE_LAYOUT.placements.editor }
      : storedPlacements;
    const placementValues = legacyPlacements && WORKSPACE_PANES.map((pane) => legacyPlacements[pane]);
    const placementsValid = placementValues
      && placementValues.every((slot) => DOCK_SLOTS.includes(slot as DockSlot))
      && new Set(placementValues).size === WORKSPACE_PANES.length;
    if (!placementsValid) return copyDefaultLayout();

    const result = copyDefaultLayout();
    result.placements = Object.fromEntries(
      WORKSPACE_PANES.map((pane) => [pane, legacyPlacements[pane]]),
    ) as Record<WorkspacePaneId, DockSlot>;
    for (const zone of ["left", "right", "bottom"] as const) {
      const size = Number(parsed.sizes?.[zone]);
      if (Number.isFinite(size)) result.sizes[zone] = clamp(size, DOCK_SIZE_LIMITS[zone]);
    }
    for (const zone of ["left", "center", "right", "bottom"] as const) {
      const split = Number(parsed.splits?.[zone]);
      if (Number.isFinite(split)) result.splits[zone] = clamp(split, SPLIT_LIMITS);
    }
    return result;
  } catch {
    return copyDefaultLayout();
  }
}

export function moveWorkspacePane(layout: WorkspaceLayout, pane: WorkspacePaneId, target: DockSlot): WorkspaceLayout {
  const current = layout.placements[pane];
  if (current === target) return layout;
  const occupant = WORKSPACE_PANES.find((candidate) => layout.placements[candidate] === target);
  const placements = { ...layout.placements, [pane]: target };
  if (occupant) placements[occupant] = current;
  return { ...layout, placements };
}

export function resizeDock(layout: WorkspaceLayout, zone: DockSizeZone, value: number): WorkspaceLayout {
  return {
    ...layout,
    sizes: { ...layout.sizes, [zone]: clamp(value, DOCK_SIZE_LIMITS[zone]) },
  };
}

export function resizeDockSplit(layout: WorkspaceLayout, zone: DockZone, value: number): WorkspaceLayout {
  return {
    ...layout,
    splits: { ...layout.splits, [zone]: clamp(value, SPLIT_LIMITS) },
  };
}
