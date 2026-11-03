import type {
  AiProposal,
  BuildResult,
  Diagnostic,
  EngineId,
  EngineInfo,
  ProjectSnapshot,
  SaveAsResult,
  SelectionRange,
  SyncTexPdfPosition,
  SyncTexSourcePosition,
} from "../types";
import { demoProject, demoSource } from "../demo";

export type DesktopMenuAction = "open-project" | "open-recent" | "save" | "save-as" | "print-pdf" | "open-pdf";

export const isDesktop = () => typeof window !== "undefined" && typeof window.lattice?.invoke === "function";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.lattice) throw new Error("The Lattice desktop bridge is unavailable");
  return window.lattice.invoke<T>(command, args);
}

export async function detectEngines(): Promise<EngineInfo[]> {
  if (!isDesktop()) {
    return [
      { id: "pdflatex", label: "pdfLaTeX", available: true, path: "/usr/bin/pdflatex" },
      { id: "xelatex", label: "XeLaTeX", available: true, path: "/usr/bin/xelatex" },
      { id: "lualatex", label: "LuaLaTeX", available: true, path: "/usr/bin/lualatex" },
    ];
  }
  return invoke("detect_engines");
}

export async function chooseProject(): Promise<ProjectSnapshot | null> {
  if (!isDesktop()) return demoProject;
  return invoke("choose_project");
}

export async function readStarterProject(): Promise<ProjectSnapshot> {
  if (!isDesktop()) return demoProject;
  return invoke("read_starter_project");
}

export async function readProject(root: string): Promise<ProjectSnapshot> {
  if (!isDesktop()) return demoProject;
  return invoke("read_project", { root });
}

export async function readFile(root: string, path: string): Promise<string> {
  if (!isDesktop()) return path === "main.tex" ? demoSource : "";
  return invoke("read_project_file", { root, path });
}

export async function writeFile(root: string, path: string, content: string): Promise<void> {
  if (!isDesktop()) return;
  return invoke("write_project_file", { root, path, content });
}

export async function saveFileAs(
  root: string,
  path: string,
  rootDocument: string,
  content: string,
): Promise<SaveAsResult | null> {
  if (!isDesktop()) return null;
  return invoke("save_project_file_as", { root, path, rootDocument, content });
}

export async function openBuiltPdf(root: string, rootDocument: string): Promise<void> {
  if (!isDesktop()) throw new Error("Opening the rendered PDF externally is available in the desktop app.");
  return invoke("open_built_pdf", { root, rootDocument });
}

export async function printBuiltPdf(root: string, rootDocument: string): Promise<void> {
  if (!isDesktop()) throw new Error("Printing is available in the desktop app.");
  return invoke("print_built_pdf", { root, rootDocument });
}

export async function updateNativeRecentProjects(recent: { root: string; name: string }[]): Promise<void> {
  if (!isDesktop()) return;
  return invoke("set_recent_projects", { recent });
}

export function subscribeToDesktopMenu(
  callback: (action: DesktopMenuAction, payload?: string) => void,
): () => void {
  return window.lattice?.onMenuAction?.(callback) ?? (() => undefined);
}

export async function compileProject(
  root: string,
  rootDocument: string,
  engine: EngineId,
  background = false,
): Promise<BuildResult> {
  if (!isDesktop()) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      success: true,
      durationMs: 914,
      engine,
      diagnostics: [],
      log: "Browser preview mode: connect the Rust backend to compile with TeX Live.",
    };
  }
  if (root === demoProject.root) {
    throw new Error("Open a local project before building.");
  }
  return invoke("compile_project", { root, rootDocument, engine, background });
}

export async function renderPdfPage(
  root: string,
  rootDocument: string,
  pdfVersion: string,
  page: number,
): Promise<string> {
  if (!isDesktop()) throw new Error("Native PDF rendering is available in the desktop app.");
  const result = await invoke<{ svgBase64: string }>("render_pdf_page", {
    root,
    rootDocument,
    pdfVersion,
    page,
  });
  return result.svgBase64;
}

export async function forwardSearch(
  root: string,
  rootDocument: string,
  path: string,
  line: number,
  column: number,
): Promise<SyncTexPdfPosition> {
  if (!isDesktop()) throw new Error("SyncTeX navigation is available in the desktop app.");
  return invoke("forward_search", { root, rootDocument, path, line, column });
}

export async function inverseSearch(
  root: string,
  rootDocument: string,
  page: number,
  x: number,
  y: number,
): Promise<SyncTexSourcePosition> {
  if (!isDesktop()) throw new Error("SyncTeX navigation is available in the desktop app.");
  return invoke("inverse_search", { root, rootDocument, page, x, y });
}

export async function askAi(input: {
  root: string;
  path: string;
  source: string;
  prompt: string;
  selection?: SelectionRange;
  diagnostics: Diagnostic[];
}): Promise<AiProposal> {
  if (isDesktop()) return invoke("propose_ai_edit", { request: input });

  await new Promise((resolve) => setTimeout(resolve, 700));
  const selected = input.selection?.text || input.source;
  let replacement = selected;
  let summary = "Refine the selected prose";
  let explanation = "This preview demonstrates the review-first patch flow. Configure OPENAI_API_KEY in the desktop app for model-backed edits.";

  if (/cautious|academic|claim/i.test(input.prompt)) {
    replacement = selected
      .replace(/clearly prove/gi, "suggest")
      .replace(/always([ \t\r\n]+)produce/gi, "can$1produce");
    summary = "Temper the strength of the claim";
    explanation = "The revision replaces absolute causal language with wording that better matches ordinary empirical evidence.";
  }

  return { summary, explanation, replacement, mode: "demo" };
}

declare global {
  interface Window {
    lattice?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
      onMenuAction?(callback: (action: DesktopMenuAction, payload?: string) => void): () => void;
    };
  }
}
