export type EngineId = "pdflatex" | "xelatex" | "lualatex";

export interface EngineInfo {
  id: EngineId;
  label: string;
  available: boolean;
  path?: string;
}

export interface ProjectFile {
  path: string;
  name: string;
  kind: "tex" | "bib" | "image" | "other";
}

export interface ProjectSnapshot {
  root: string;
  name: string;
  rootDocument: string;
  files: ProjectFile[];
}

export interface SaveAsResult {
  project: ProjectSnapshot;
  path: string;
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
}

export interface BuildResult {
  success: boolean;
  durationMs: number;
  engine: EngineId;
  diagnostics: Diagnostic[];
  log: string;
  pdfBase64?: string;
  pdfVersion?: string;
}

export interface SyncTexPdfPosition {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncTexSourcePosition {
  path: string;
  line: number;
  column: number;
}

export interface AiProposal {
  summary: string;
  explanation: string;
  replacement: string;
  mode: "live" | "demo";
}

export interface SelectionRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface EditorController {
  focus: () => void;
  undo: () => void;
  redo: () => void;
  replaceContent: (content: string) => void;
  replaceSelection: (selection: SelectionRange | undefined, replacement: string) => void;
  insertText: (text: string) => void;
  insertTable: (text: string, requiredPackages: string[], selection?: SelectionRange) => string[];
  openTableAt: (line: number, column: number, path?: string) => boolean;
  applyFormatting: (format: import("./editorFormatting").EditorFormat) => void;
  insertMath: (command: import("./mathCommands").MathCommandId) => void;
  insertCustomCommand: (template: string) => void;
  getSelection: () => SelectionRange | undefined;
  hasTextFocus: () => boolean;
  deleteCurrentLine: () => void;
  toggleLineComment: () => void;
  revealLine: (line: number) => void;
  revealPosition: (line: number, column: number) => void;
}
