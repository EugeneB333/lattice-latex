export const CUSTOM_COMMAND_COUNT = 12;

export interface UserCommand {
  label: string;
  template: string;
}

export function defaultUserCommands(): UserCommand[] {
  return Array.from({ length: CUSTOM_COMMAND_COUNT }, (_, index) => ({
    label: `C${index + 1}`,
    template: "",
  }));
}

function normaliseCommand(value: unknown, index: number): UserCommand {
  if (!value || typeof value !== "object") return defaultUserCommands()[index];
  const candidate = value as Partial<UserCommand>;
  return {
    label: typeof candidate.label === "string"
      ? candidate.label.slice(0, 32)
      : `C${index + 1}`,
    template: typeof candidate.template === "string"
      ? candidate.template.slice(0, 10_000)
      : "",
  };
}

export function userCommandsFromStorage(raw: string | null): UserCommand[] {
  if (!raw) return defaultUserCommands();
  try {
    const saved = JSON.parse(raw) as unknown;
    if (!Array.isArray(saved)) return defaultUserCommands();
    return Array.from({ length: CUSTOM_COMMAND_COUNT }, (_, index) =>
      normaliseCommand(saved[index], index),
    );
  } catch {
    return defaultUserCommands();
  }
}

function escapeSnippetText(value: string): string {
  return value.replace(/[\\$}]/g, "\\$&");
}

export function customCommandSnippet(template: string, selection = ""): string {
  const selectedValue = selection
    ? escapeSnippetText(selection)
    : "${1:text}";
  return template
    .split("{{selection}}")
    .join(selectedValue)
    .split("{{cursor}}")
    .join("$0");
}

export function customCommandIndexFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">,
): number | undefined {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return undefined;
  const match = /^F([1-9]|1[0-2])$/.exec(event.key);
  return match ? Number(match[1]) - 1 : undefined;
}
