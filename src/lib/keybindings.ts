export type HotkeyAction = "build" | "deleteLine" | "toggleComment";
export type Keybindings = Record<HotkeyAction, string>;

export const DEFAULT_KEYBINDINGS: Keybindings = {
  build: "F1",
  deleteLine: "Ctrl+D",
  toggleComment: "Ctrl+M",
};

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export function hotkeyFromEvent(event: KeyEventLike): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");

  const key = event.key === " "
    ? "Space"
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key;
  return [...modifiers, key].join("+");
}

export function keybindingsFromStorage(value: string | null): Keybindings {
  if (!value) return { ...DEFAULT_KEYBINDINGS };
  try {
    const parsed = JSON.parse(value) as Partial<Keybindings>;
    return {
      build: typeof parsed.build === "string" && parsed.build ? parsed.build : DEFAULT_KEYBINDINGS.build,
      deleteLine: typeof parsed.deleteLine === "string" && parsed.deleteLine ? parsed.deleteLine : DEFAULT_KEYBINDINGS.deleteLine,
      toggleComment: typeof parsed.toggleComment === "string" && parsed.toggleComment ? parsed.toggleComment : DEFAULT_KEYBINDINGS.toggleComment,
    };
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}
