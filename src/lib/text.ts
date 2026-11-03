import type { SelectionRange } from "../types";

export type LatexOutlineItem = {
  command: "part" | "chapter" | "section" | "subsection" | "subsubsection" | "paragraph" | "subparagraph";
  title: string;
  line: number;
  depth: number;
};

const OUTLINE_DEPTH: Record<LatexOutlineItem["command"], number> = {
  part: 0,
  chapter: 0,
  section: 0,
  subsection: 1,
  subsubsection: 2,
  paragraph: 3,
  subparagraph: 4,
};

export function replaceSelection(
  source: string,
  selection: SelectionRange | undefined,
  replacement: string,
): string {
  if (!selection) return replacement;
  const lines = source.split("\n");
  const firstLine = lines[selection.startLine - 1] ?? "";
  const lastLine = lines[selection.endLine - 1] ?? "";
  const prefix = firstLine.slice(0, selection.startColumn - 1);
  const suffix = lastLine.slice(selection.endColumn - 1);
  return [
    ...lines.slice(0, selection.startLine - 1),
    `${prefix}${replacement}${suffix}`,
    ...lines.slice(selection.endLine),
  ].join("\n");
}

export function diffLines(before: string, after: string) {
  const left = before.split("\n");
  const right = after.split("\n");
  const rows: Array<{ type: "same" | "remove" | "add"; text: string }> = [];
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i += 1) {
    if (left[i] === right[i]) rows.push({ type: "same", text: left[i] ?? "" });
    else {
      if (left[i] !== undefined) rows.push({ type: "remove", text: left[i] });
      if (right[i] !== undefined) rows.push({ type: "add", text: right[i] });
    }
  }
  return rows;
}

export function basename(path: string) {
  return path.split("/").pop() ?? path;
}

export function parseLatexOutline(source: string): LatexOutlineItem[] {
  return source.split("\n").flatMap((line, index) => {
    const match = line.match(/^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{([^}]*)\}/);
    if (!match) return [];
    const command = match[1] as LatexOutlineItem["command"];
    return [{ command, title: match[2].trim() || "Untitled", line: index + 1, depth: OUTLINE_DEPTH[command] }];
  });
}
