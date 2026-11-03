import Editor, { type OnMount } from "@monaco-editor/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bot,
  Bold,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  ExternalLink,
  Hammer,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTree,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Pilcrow,
  Plus,
  Printer,
  Quote,
  Redo2,
  Save,
  Search,
  Settings2,
  Sigma,
  SpellCheck2,
  Sparkles,
  Table2,
  Underline,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { demoProject, demoSource } from "./demo";
import { PdfPreview } from "./PdfPreview";
import { MathVisualMenu } from "./MathVisualMenu";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { TableEditor } from "./TableEditor";
import { configureMonaco, THEMES, type ThemeId } from "./editorThemes";
import { createFormattingEdit, formatUsesCurrentLine, type EditorFormat } from "./editorFormatting";
import {
  customCommandIndexFromKeyboardEvent,
  customCommandSnippet,
  defaultUserCommands,
  userCommandsFromStorage,
  type UserCommand,
} from "./customCommands";
import { updateLatexProjectFiles, updateLatexProjectSources } from "./latexLanguage";
import {
  ACCENT_COMMANDS,
  GREEK_COMMANDS,
  mathSnippet,
  SPECIAL_COMMANDS,
  STRUCTURE_COMMANDS,
  SYMBOL_COMMANDS,
  type MathCommandId,
} from "./mathCommands";
import {
  askAi,
  chooseProject,
  compileProject,
  detectEngines,
  forwardSearch,
  inverseSearch,
  isDesktop,
  openBuiltPdf,
  printBuiltPdf,
  readFile,
  readProject,
  readStarterProject,
  renderPdfPage,
  saveFileAs,
  subscribeToDesktopMenu,
  updateNativeRecentProjects,
  writeFile,
} from "./lib/desktop";
import { basename, diffLines, parseLatexOutline, replaceSelection, type LatexOutlineItem } from "./lib/text";
import { createBuildScheduler, type BuildRequest, type BuildScheduler } from "./lib/buildScheduler";
import { loadEditorDocument } from "./lib/editorModel";
import { insertEditorText } from "./lib/editorInsertion";
import { registerScriptBraces } from "./lib/scriptBraces";
import { createLatexPreambleInsertion } from "./lib/latexPreamble";
import { handleSmartTablePaste } from "./latexTable";
import { parseLatexTableAt } from "./latexTableParser";
import {
  closeProjectSession,
  closeSessionFile,
  createProjectSession,
  openSessionFile,
  upsertProjectSession,
  type ProjectSession,
} from "./lib/projectSessions";
import {
  loadWorkspaceSession,
  reconcileStoredProjectSession,
  storeWorkspaceSession,
} from "./lib/workspaceSession";
import {
  loadRecentProjects,
  rememberRecentProject,
  storeRecentProjects,
} from "./lib/recentProjects";
import {
  DEFAULT_KEYBINDINGS,
  hotkeyFromEvent,
  keybindingsFromStorage,
  type HotkeyAction,
  type Keybindings,
} from "./lib/keybindings";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  DOCK_SIZE_LIMITS,
  DOCK_SLOTS,
  SPLIT_LIMITS,
  WORKSPACE_PANES,
  dockZone,
  moveWorkspacePane,
  resizeDock,
  resizeDockSplit,
  workspaceLayoutFromStorage,
  type DockSlot,
  type DockZone,
  type WorkspaceLayout,
  type WorkspacePaneId,
} from "./lib/workspaceLayout";
import type {
  AiProposal,
  BuildResult,
  Diagnostic,
  EditorController,
  EngineId,
  EngineInfo,
  ProjectFile,
  ProjectSnapshot,
  SelectionRange,
  SyncTexPdfPosition,
} from "./types";
import type { SpellcheckController, SpellcheckDialectId, SpellcheckStatus } from "./spellcheck";

type MonacoEditor = Parameters<OnMount>[0];

type FontId = "jetbrains" | "fira" | "source-code" | "system";
type ToolbarPosition = "top" | "bottom" | "left" | "right";
type BuildMode = "on-demand" | "live";
type TableEditorState =
  | { mode: "insert" }
  | { mode: "edit"; initialTable: import("./latexTable").LatexTableOptions; selection: SelectionRange; path: string };

const FONT_OPTIONS: { id: FontId; label: string; family: string }[] = [
  { id: "jetbrains", label: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
  { id: "fira", label: "Fira Code", family: "'Fira Code', monospace" },
  { id: "source-code", label: "Source Code Pro", family: "'Source Code Pro', monospace" },
  { id: "system", label: "System monospace", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
];

function initialTheme(): ThemeId {
  const saved = window.localStorage.getItem("lattice-theme");
  return THEMES.some((theme) => theme.id === saved) ? saved as ThemeId : "lattice";
}

function initialFont(): FontId {
  const saved = window.localStorage.getItem("lattice-editor-font");
  return FONT_OPTIONS.some((font) => font.id === saved) ? saved as FontId : "jetbrains";
}

function initialFontSize(): number {
  const saved = Number(window.localStorage.getItem("lattice-editor-font-size"));
  return Number.isFinite(saved) && saved >= 11 && saved <= 22 ? saved : 13.5;
}

function initialKeybindings(): Keybindings {
  return keybindingsFromStorage(window.localStorage.getItem("lattice-keybindings"));
}

function initialWorkspaceLayout(): WorkspaceLayout {
  return workspaceLayoutFromStorage(window.localStorage.getItem("lattice-workspace-layout"));
}

function initialSpellcheckEnabled() {
  return window.localStorage.getItem("lattice-spellcheck-enabled") !== "false";
}

function initialSpellcheckDialect(): SpellcheckDialectId {
  const saved = window.localStorage.getItem("lattice-spellcheck-dialect");
  return ["american", "british", "australian", "canadian", "indian"].includes(saved ?? "")
    ? saved as SpellcheckDialectId
    : "british";
}

function initialMathToolbarEnabled() {
  return window.localStorage.getItem("lattice-math-toolbar-enabled") !== "false";
}

function initialMathToolbarPosition(): ToolbarPosition {
  const saved = window.localStorage.getItem("lattice-math-toolbar-position");
  return saved === "bottom" || saved === "left" || saved === "right" ? saved : "top";
}

function initialCustomToolbarEnabled() {
  return window.localStorage.getItem("lattice-custom-toolbar-enabled") !== "false";
}

function initialCustomToolbarPosition(): ToolbarPosition {
  const saved = window.localStorage.getItem("lattice-custom-toolbar-position");
  return saved === "bottom" || saved === "left" || saved === "right" ? saved : "top";
}

function initialCustomCommands(): UserCommand[] {
  return userCommandsFromStorage(window.localStorage.getItem("lattice-custom-commands"));
}

function initialBuildMode(): BuildMode {
  return window.localStorage.getItem("lattice-build-mode") === "live" ? "live" : "on-demand";
}

const SPELLCHECK_DIALECTS: { id: SpellcheckDialectId; label: string }[] = [
  { id: "american", label: "English (United States)" },
  { id: "british", label: "English (United Kingdom)" },
  { id: "australian", label: "English (Australia)" },
  { id: "canadian", label: "English (Canada)" },
  { id: "indian", label: "English (India)" },
];

const QUICK_PROMPTS = [
  "Make this more cautious and academically precise",
  "Explain the current compile error and propose a fix",
  "Improve clarity while preserving all LaTeX commands",
];

function ToolbarButton({
  label,
  shortcut,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EditorToolbar({
  disabled,
  onUndo,
  onRedo,
  onFormat,
  onInsertTable,
}: {
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFormat: (format: EditorFormat) => void;
  onInsertTable: () => void;
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Document formatting">
      <div className="toolbar-group">
        <ToolbarButton label="Undo" shortcut="Ctrl+Z" onClick={onUndo}><Undo2 size={14} /></ToolbarButton>
        <ToolbarButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={onRedo}><Redo2 size={14} /></ToolbarButton>
      </div>
      <span className="toolbar-divider" />
      <label className={`toolbar-style ${disabled ? "disabled" : ""}`} title="Paragraph style">
        <Pilcrow size={13} />
        <select
          aria-label="Paragraph style"
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value) onFormat(event.target.value as EditorFormat);
            event.target.value = "";
          }}
        >
          <option value="">Normal text</option>
          <option value="section">Section</option>
          <option value="subsection">Subsection</option>
          <option value="subsubsection">Subsubsection</option>
          <option value="paragraph">Paragraph heading</option>
        </select>
      </label>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        <ToolbarButton label="Bold" shortcut="Ctrl+B" disabled={disabled} onClick={() => onFormat("bold")}><Bold size={14} /></ToolbarButton>
        <ToolbarButton label="Italic" shortcut="Ctrl+I" disabled={disabled} onClick={() => onFormat("italic")}><Italic size={14} /></ToolbarButton>
        <ToolbarButton label="Underline" shortcut="Ctrl+U" disabled={disabled} onClick={() => onFormat("underline")}><Underline size={14} /></ToolbarButton>
        <ToolbarButton label="Monospace" disabled={disabled} onClick={() => onFormat("monospace")}><Code2 size={14} /></ToolbarButton>
      </div>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        <ToolbarButton label="Bulleted list" disabled={disabled} onClick={() => onFormat("bullet-list")}><List size={14} /></ToolbarButton>
        <ToolbarButton label="Numbered list" disabled={disabled} onClick={() => onFormat("numbered-list")}><ListOrdered size={14} /></ToolbarButton>
        <ToolbarButton label="Block quote" disabled={disabled} onClick={() => onFormat("quote")}><Quote size={14} /></ToolbarButton>
        <ToolbarButton label="Align left" disabled={disabled} onClick={() => onFormat("left")}><AlignLeft size={14} /></ToolbarButton>
        <ToolbarButton label="Centre" disabled={disabled} onClick={() => onFormat("center")}><AlignCenter size={14} /></ToolbarButton>
        <ToolbarButton label="Align right" disabled={disabled} onClick={() => onFormat("right")}><AlignRight size={14} /></ToolbarButton>
      </div>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        <ToolbarButton label="Insert link" disabled={disabled} onClick={() => onFormat("link")}><Link2 size={14} /></ToolbarButton>
        <ToolbarButton label="Inline mathematics" disabled={disabled} onClick={() => onFormat("inline-math")}><Sigma size={14} /></ToolbarButton>
        <ToolbarButton label="Insert table" shortcut="Ctrl/Cmd+Shift+click a table to edit" disabled={disabled} onClick={onInsertTable}><Table2 size={14} /></ToolbarButton>
      </div>
    </div>
  );
}

function MathCommandMenu({
  label,
  title,
  commands,
  disabled,
  onInsert,
}: {
  label: React.ReactNode;
  title: string;
  commands: typeof GREEK_COMMANDS;
  disabled: boolean;
  onInsert: (command: MathCommandId) => void;
}) {
  const groups = Array.from(new Set(commands.map((command) => command.group).filter((group): group is string => Boolean(group))));
  const option = (command: (typeof commands)[number]) => (
    <option key={command.id} value={command.id}>{command.label} — {command.title}</option>
  );
  return (
    <label className={`math-command-menu ${disabled ? "disabled" : ""}`} title={title}>
      <span aria-hidden="true">{label}</span>
      <ChevronDown size={10} />
      <select
        aria-label={title}
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onInsert(event.target.value as MathCommandId);
          event.target.value = "";
        }}
      >
        <option value="" disabled>{title}</option>
        {groups.length
          ? groups.map((group) => <optgroup key={group} label={group}>{commands.filter((command) => command.group === group).map(option)}</optgroup>)
          : commands.map(option)}
      </select>
    </label>
  );
}

function MathToolbar({
  disabled,
  position,
  onInsert,
}: {
  disabled: boolean;
  position: ToolbarPosition;
  onInsert: (command: MathCommandId) => void;
}) {
  const button = (id: MathCommandId, label: string, title: string) => (
    <ToolbarButton key={id} className="math-command-button" label={title} disabled={disabled} onClick={() => onInsert(id)}>
      <span>{label}</span>
    </ToolbarButton>
  );
  return (
    <div className={`math-toolbar ${position}`} role="toolbar" aria-label="Mathematics commands">
      <span className="math-toolbar-label"><Sigma size={13} /> Maths</span>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        {button("inline", "$x$", "Inline mathematics")}
        {button("display", "[x]", "Display mathematics")}
        {button("fraction", "a⁄b", "Fraction")}
        {button("sqrt", "√x", "Square root")}
        {button("nth-root", "ⁿ√x", "Nth root")}
        {button("superscript", "xⁿ", "Superscript")}
        {button("subscript", "xᵢ", "Subscript")}
      </div>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        {button("parentheses", "( )", "Automatically sized parentheses")}
        {button("brackets", "[ ]", "Automatically sized brackets")}
        {button("absolute", "|x|", "Absolute value")}
      </div>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        {button("sum", "∑", "Summation")}
        {button("product", "∏", "Product")}
        {button("integral", "∫", "Definite integral")}
        {button("limit", "lim", "Limit")}
        {button("derivative", "d⁄dx", "Derivative")}
        {button("partial-derivative", "∂⁄∂x", "Partial derivative")}
      </div>
      <MathVisualMenu
        title="Vectors and accents"
        triggerLatex={"\\vec{\\mathbf{v}}"}
        commands={ACCENT_COMMANDS}
        disabled={disabled}
        onInsert={onInsert}
      />
      <span className="toolbar-divider" />
      <MathCommandMenu label="αβ" title="Greek letters" commands={GREEK_COMMANDS} disabled={disabled} onInsert={onInsert} />
      <MathCommandMenu label="ℏ" title="Special symbols" commands={SPECIAL_COMMANDS} disabled={disabled} onInsert={onInsert} />
      <MathCommandMenu label="≤ ≈" title="Mathematical symbols" commands={SYMBOL_COMMANDS} disabled={disabled} onInsert={onInsert} />
      <MathCommandMenu label="▦" title="Equation structures" commands={STRUCTURE_COMMANDS} disabled={disabled} onInsert={onInsert} />
    </div>
  );
}

function CustomToolbar({
  commands,
  disabled,
  position,
  onInsert,
}: {
  commands: UserCommand[];
  disabled: boolean;
  position: ToolbarPosition;
  onInsert: (template: string) => void;
}) {
  return (
    <div className={`math-toolbar custom-toolbar ${position}`} role="toolbar" aria-label="User-defined commands">
      <span className="math-toolbar-label"><Braces size={13} /> Custom</span>
      <span className="toolbar-divider" />
      <div className="toolbar-group">
        {commands.map((command, index) => {
          const shortcut = `Shift+F${index + 1}`;
          const label = command.label.trim() || `C${index + 1}`;
          return (
            <ToolbarButton
              key={index}
              className="custom-command-button"
              label={label}
              shortcut={shortcut}
              disabled={disabled || !command.template.trim()}
              onClick={() => onInsert(command.template)}
            >
              <span>{label}</span>
              <kbd>F{index + 1}</kbd>
            </ToolbarButton>
          );
        })}
      </div>
    </div>
  );
}

function KeybindingRecorder({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      type="button"
      className={`keybinding-recorder ${recording ? "recording" : ""}`}
      aria-label={`${label} shortcut: ${value}`}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          setRecording(false);
          return;
        }
        const hotkey = hotkeyFromEvent(event);
        if (!hotkey) return;
        onChange(hotkey);
        setRecording(false);
      }}
    >
      {recording ? "Press shortcut…" : value.split("+").map((part) => <kbd key={part}>{part}</kbd>)}
    </button>
  );
}

const SETTINGS_TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "commands", label: "Custom Commands" },
  { id: "writing", label: "Writing" },
  { id: "shortcuts", label: "Shortcuts" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

function SettingsPanel({
  theme,
  font,
  fontSize,
  mathToolbarEnabled,
  mathToolbarPosition,
  customToolbarEnabled,
  customToolbarPosition,
  customCommands,
  buildMode,
  spellcheckEnabled,
  spellcheckDialect,
  keybindings,
  onThemeChange,
  onFontChange,
  onFontSizeChange,
  onMathToolbarEnabledChange,
  onMathToolbarPositionChange,
  onCustomToolbarEnabledChange,
  onCustomToolbarPositionChange,
  onCustomCommandChange,
  onBuildModeChange,
  onSpellcheckEnabledChange,
  onSpellcheckDialectChange,
  onKeybindingChange,
  onReset,
  onClose,
}: {
  theme: ThemeId;
  font: FontId;
  fontSize: number;
  mathToolbarEnabled: boolean;
  mathToolbarPosition: ToolbarPosition;
  customToolbarEnabled: boolean;
  customToolbarPosition: ToolbarPosition;
  customCommands: UserCommand[];
  buildMode: BuildMode;
  spellcheckEnabled: boolean;
  spellcheckDialect: SpellcheckDialectId;
  keybindings: Keybindings;
  onThemeChange: (theme: ThemeId) => void;
  onFontChange: (font: FontId) => void;
  onFontSizeChange: (size: number) => void;
  onMathToolbarEnabledChange: (enabled: boolean) => void;
  onMathToolbarPositionChange: (position: ToolbarPosition) => void;
  onCustomToolbarEnabledChange: (enabled: boolean) => void;
  onCustomToolbarPositionChange: (position: ToolbarPosition) => void;
  onCustomCommandChange: (index: number, command: Partial<UserCommand>) => void;
  onBuildModeChange: (mode: BuildMode) => void;
  onSpellcheckEnabledChange: (enabled: boolean) => void;
  onSpellcheckDialectChange: (dialect: SpellcheckDialectId) => void;
  onKeybindingChange: (action: HotkeyAction, hotkey: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("appearance");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const fontFamily = FONT_OPTIONS.find((item) => item.id === font)?.family ?? FONT_OPTIONS[0].family;

  return (
    <div className="settings-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div className="settings-icon"><Settings2 size={17} /></div>
          <div><h2 id="settings-title">Editor settings</h2><p>Personalise your writing workspace</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </header>

        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings categories"
          onKeyDown={(event) => {
            const currentIndex = SETTINGS_TABS.findIndex((tab) => tab.id === activeTab);
            let nextIndex = currentIndex;
            if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
            else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = SETTINGS_TABS.length - 1;
            else return;
            event.preventDefault();
            setActiveTab(SETTINGS_TABS[nextIndex].id);
            tabRefs.current[nextIndex]?.focus();
          }}
        >
          {SETTINGS_TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" hidden={activeTab !== "appearance"}>
          <div className="settings-section-label">Appearance</div>
          <label className="settings-field">
            <span><strong>Colour theme</strong><small>Changes the interface and syntax palette</small></span>
            <select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeId)} aria-label="Colour theme">
              {THEMES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          <div className="theme-strip" aria-label="Theme previews">
            {THEMES.map((item) => <button key={item.id} type="button" data-theme-id={item.id} className={item.id === theme ? "active" : ""} aria-label={`Use ${item.label}`} aria-pressed={item.id === theme} onClick={() => onThemeChange(item.id)}><i /><i /><i /></button>)}
          </div>

          <div className="settings-divider" />
          <div className="settings-section-label">Typography</div>
          <label className="settings-field">
            <span><strong>Editor font</strong><small>Monospaced typeface used for source files</small></span>
            <select value={font} onChange={(event) => onFontChange(event.target.value as FontId)} aria-label="Editor font">
              {FONT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="settings-field settings-size-field">
            <span><strong>Font size</strong><small>Between 11 and 22 pixels</small></span>
            <span className="size-control">
              <input type="range" min="11" max="22" step="0.5" value={fontSize} onChange={(event) => onFontSizeChange(Number(event.target.value))} aria-label="Editor font size" />
              <output>{fontSize}px</output>
            </span>
          </label>
          <div className="font-preview" style={{ fontFamily, fontSize: Math.min(16, fontSize) }}>
            <span>\section</span>{"{Beautiful documents}"} <em>% a comment</em>
          </div>

          </div>

          <div id="settings-panel-editor" role="tabpanel" aria-labelledby="settings-tab-editor" hidden={activeTab !== "editor"}>
          <div className="settings-section-label">Toolbars</div>
          <label className="settings-field">
            <span><strong>Maths toolbar</strong><small>Frequently used notation, symbols, and equation structures</small></span>
            <input
              className="settings-toggle"
              type="checkbox"
              checked={mathToolbarEnabled}
              onChange={(event) => onMathToolbarEnabledChange(event.target.checked)}
              aria-label="Show maths toolbar"
            />
          </label>
          <label className={`settings-field ${mathToolbarEnabled ? "" : "disabled"}`}>
            <span><strong>Maths toolbar position</strong><small>Place it around the source editor</small></span>
            <select
              value={mathToolbarPosition}
              disabled={!mathToolbarEnabled}
              onChange={(event) => onMathToolbarPositionChange(event.target.value as ToolbarPosition)}
              aria-label="Maths toolbar position"
            >
              <option value="top">Above editor</option>
              <option value="bottom">Below editor</option>
              <option value="left">Left of editor</option>
              <option value="right">Right of editor</option>
            </select>
          </label>
          <label className="settings-field">
            <span><strong>Custom commands toolbar</strong><small>Twelve personal snippets with fixed Shift+F1–F12 shortcuts</small></span>
            <input
              className="settings-toggle"
              type="checkbox"
              checked={customToolbarEnabled}
              onChange={(event) => onCustomToolbarEnabledChange(event.target.checked)}
              aria-label="Show custom commands toolbar"
            />
          </label>
          <label className={`settings-field ${customToolbarEnabled ? "" : "disabled"}`}>
            <span><strong>Custom toolbar position</strong><small>Place it around the source editor</small></span>
            <select
              value={customToolbarPosition}
              disabled={!customToolbarEnabled}
              onChange={(event) => onCustomToolbarPositionChange(event.target.value as ToolbarPosition)}
              aria-label="Custom commands toolbar position"
            >
              <option value="top">Above editor</option>
              <option value="bottom">Below editor</option>
              <option value="left">Left of editor</option>
              <option value="right">Right of editor</option>
            </select>
          </label>

          <div className="settings-divider" />
          <div className="settings-section-label">Build &amp; preview</div>
          <label className="settings-field">
            <span>
              <strong>Preview updates</strong>
              <small>Live mode waits until typing stops and never runs overlapping builds</small>
            </span>
            <select
              value={buildMode}
              onChange={(event) => onBuildModeChange(event.target.value as BuildMode)}
              aria-label="Preview update mode"
            >
              <option value="on-demand">Build on demand</option>
              <option value="live">Live preview</option>
            </select>
          </label>

          </div>

          <div id="settings-panel-commands" role="tabpanel" aria-labelledby="settings-tab-commands" hidden={activeTab !== "commands"}>
          <div className="settings-section-label">Custom commands</div>
          <p className="custom-command-help">
            Use <code>{"{{selection}}"}</code> for selected text, <code>{"{{cursor}}"}</code> for the final cursor,
            and <code>{"${1:argument}"}</code> for Tab stops. Shortcuts work even when the toolbar is hidden.
          </p>
          <div className="custom-command-settings">
            {customCommands.map((command, index) => (
              <div className="custom-command-setting" key={index}>
                <div>
                  <kbd>Shift+F{index + 1}</kbd>
                  <input
                    type="text"
                    value={command.label}
                    maxLength={32}
                    placeholder={`Command ${index + 1}`}
                    aria-label={`Custom command ${index + 1} label`}
                    onChange={(event) => onCustomCommandChange(index, { label: event.target.value })}
                  />
                </div>
                <textarea
                  rows={2}
                  value={command.template}
                  spellCheck={false}
                  placeholder={`\\command{${"${1:argument}"}}`}
                  aria-label={`Custom command ${index + 1} template`}
                  onChange={(event) => onCustomCommandChange(index, { template: event.target.value })}
                />
              </div>
            ))}
          </div>

          </div>

          <div id="settings-panel-writing" role="tabpanel" aria-labelledby="settings-tab-writing" hidden={activeTab !== "writing"}>
          <div className="settings-section-label">Writing assistance</div>
          <label className="settings-field">
            <span><strong>Spelling, grammar &amp; style</strong><small>Private, LaTeX-aware checking powered by Harper</small></span>
            <input
              className="settings-toggle"
              type="checkbox"
              checked={spellcheckEnabled}
              onChange={(event) => onSpellcheckEnabledChange(event.target.checked)}
              aria-label="Enable spelling, grammar and style checking"
            />
          </label>
          <label className={`settings-field ${spellcheckEnabled ? "" : "disabled"}`}>
            <span><strong>English dialect</strong><small>Controls regional spelling and usage suggestions</small></span>
            <select
              value={spellcheckDialect}
              disabled={!spellcheckEnabled}
              onChange={(event) => onSpellcheckDialectChange(event.target.value as SpellcheckDialectId)}
              aria-label="Spell-check dialect"
            >
              {SPELLCHECK_DIALECTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <p className="settings-privacy-note">Checks run locally in a background worker. Document text never leaves this device.</p>

          </div>

          <div id="settings-panel-shortcuts" role="tabpanel" aria-labelledby="settings-tab-shortcuts" hidden={activeTab !== "shortcuts"}>
          <div className="settings-section-label">Keybindings</div>
          <div className="keybinding-list">
            <div className="settings-field">
              <span><strong>Build document</strong><small>Build with the selected LaTeX compiler</small></span>
              <KeybindingRecorder value={keybindings.build} label="Build document" onChange={(hotkey) => onKeybindingChange("build", hotkey)} />
            </div>
            <div className="settings-field">
              <span><strong>Delete current line</strong><small>Remove the active line or selected lines</small></span>
              <KeybindingRecorder value={keybindings.deleteLine} label="Delete current line" onChange={(hotkey) => onKeybindingChange("deleteLine", hotkey)} />
            </div>
            <div className="settings-field">
              <span><strong>Toggle line comment</strong><small>Add or remove LaTeX’s % comment marker</small></span>
              <KeybindingRecorder value={keybindings.toggleComment} label="Toggle line comment" onChange={(hotkey) => onKeybindingChange("toggleComment", hotkey)} />
            </div>
          </div>
          </div>
        </div>

        <footer className="settings-footer">
          <button className="reset-settings" onClick={onReset}>Restore defaults</button>
          <span>Changes are saved automatically</span>
        </footer>
      </section>
    </div>
  );
}

function fileIcon(file: ProjectFile) {
  if (file.kind === "image") return <Image size={14} />;
  if (file.kind === "bib") return <FileText size={14} />;
  return <FileCode2 size={14} />;
}

const DOCK_SLOT_LABELS: Record<DockSlot, string> = {
  "left-top": "Left — top",
  "left-bottom": "Left — bottom",
  "center-left": "Centre — left",
  "center-right": "Centre — right",
  "right-top": "Right — top",
  "right-bottom": "Right — bottom",
  "bottom-left": "Bottom — left",
  "bottom-right": "Bottom — right",
};

function PaneDragAffordance({
  title,
  onMouseDown,
  onActivate,
}: {
  title: string;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className="pane-drag-handle"
      aria-label={`Move ${title} pane`}
      title={`Drag the ${title} header, or click to choose a dock`}
      onMouseDown={(event) => {
        event.stopPropagation();
        onMouseDown(event);
      }}
      onClick={onActivate}
    >
      <GripVertical size={14} />
    </button>
  );
}

function DockBoundary({
  label,
  orientation,
  value,
  minimum,
  maximum,
  axis,
  sign,
  className,
  onChange,
}: {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  minimum: number;
  maximum: number;
  axis: "x" | "y";
  sign: 1 | -1;
  className: string;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={`dock-resizer ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(value)}
      onMouseDown={(event) => {
        event.preventDefault();
        const startCoordinate = axis === "x" ? event.clientX : event.clientY;
        const startValue = value;
        const move = (moveEvent: MouseEvent) => {
          const coordinate = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
          onChange(startValue + (coordinate - startCoordinate) * sign);
        };
        const stop = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", stop);
          document.body.classList.remove("resizing-dock");
        };
        document.body.classList.add("resizing-dock");
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", stop);
      }}
      onKeyDown={(event) => {
        const physicalDelta = axis === "x"
          ? event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0
          : event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0;
        if (!physicalDelta) return;
        event.preventDefault();
        onChange(value + physicalDelta * sign);
      }}
    />
  );
}

function DockSplitHandle({
  zone,
  value,
  onChange,
}: {
  zone: DockZone;
  value: number;
  onChange: (value: number) => void;
}) {
  const horizontalPanels = zone === "center" || zone === "bottom";
  return (
    <div
      className={`dock-split-resizer ${horizontalPanels ? "vertical" : "horizontal"}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${zone} dock panes`}
      aria-orientation={horizontalPanels ? "vertical" : "horizontal"}
      aria-valuemin={SPLIT_LIMITS[0]}
      aria-valuemax={SPLIT_LIMITS[1]}
      aria-valuenow={Math.round(value)}
      onMouseDown={(event) => {
        event.preventDefault();
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const startCoordinate = horizontalPanels ? event.clientX : event.clientY;
        const extent = horizontalPanels ? rect.width : rect.height;
        const startValue = value;
        const move = (moveEvent: MouseEvent) => {
          const coordinate = horizontalPanels ? moveEvent.clientX : moveEvent.clientY;
          onChange(startValue + ((coordinate - startCoordinate) / Math.max(1, extent)) * 100);
        };
        const stop = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", stop);
          document.body.classList.remove("resizing-dock");
        };
        document.body.classList.add("resizing-dock");
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", stop);
      }}
      onKeyDown={(event) => {
        const delta = horizontalPanels
          ? event.key === "ArrowRight" ? 2 : event.key === "ArrowLeft" ? -2 : 0
          : event.key === "ArrowDown" ? 2 : event.key === "ArrowUp" ? -2 : 0;
        if (!delta) return;
        event.preventDefault();
        onChange(value + delta);
      }}
    />
  );
}

function FileRail({
  project,
  activePath,
  outline,
  activeOutlineLine,
  onOpen,
  onOpenProject,
  onSelectOutline,
  dockControl,
  onDockMouseDown,
}: {
  project: ProjectSnapshot;
  activePath: string;
  outline: LatexOutlineItem[];
  activeOutlineLine?: number;
  onOpen: (file: ProjectFile) => void;
  onOpenProject: () => void;
  onSelectOutline: (line: number) => void;
  dockControl?: ReactNode;
  onDockMouseDown?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const [view, setView] = useState<"files" | "syllabus">(() =>
    window.localStorage.getItem("lattice-sidebar-view") === "syllabus" ? "syllabus" : "files",
  );
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const visibleFiles = project.files.filter((file) =>
    file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    window.localStorage.setItem("lattice-sidebar-view", view);
  }, [view]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (view === "files" && (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [view]);

  return (
    <aside className="file-rail">
      <div className="rail-top pane-drag-surface" onMouseDown={onDockMouseDown}>
        <span className="eyebrow">Navigator</span>
        <div className="pane-heading-actions">
          {view === "files" && (
            <button className="icon-button" aria-label="Open project" title="Open another project" onClick={onOpenProject}>
              <Plus size={15} />
            </button>
          )}
          {dockControl}
        </div>
      </div>
      <div className="rail-view-tabs" role="tablist" aria-label="Navigator view">
        <button type="button" role="tab" aria-selected={view === "files"} className={view === "files" ? "active" : ""} onClick={() => setView("files")}>
          <FolderOpen size={13} /> Files
        </button>
        <button type="button" role="tab" aria-selected={view === "syllabus"} className={view === "syllabus" ? "active" : ""} onClick={() => setView("syllabus")}>
          <ListTree size={13} /> Syllabus
        </button>
      </div>
      {view === "files" ? (
        <>
          <button
            className="project-name"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-controls="project-files"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <FolderOpen size={15} className="folder-icon" />
            <span>{project.name}</span>
          </button>
          <div className={`file-list ${collapsed ? "collapsed" : ""}`} id="project-files" role="tabpanel">
            {visibleFiles.map((file) => {
              const depth = file.path.split("/").length - 1;
              return (
                <button
                  key={file.path}
                  className={`file-row ${file.path === activePath ? "active" : ""}`}
                  onClick={() => onOpen(file)}
                  style={{ paddingLeft: 14 + depth * 15 }}
                  title={file.path}
                >
                  {depth > 0 && <span className="tree-guide" />}
                  {fileIcon(file)}
                  <span>{file.name}</span>
                </button>
              );
            })}
            {!collapsed && visibleFiles.length === 0 && <div className="no-files">No matching files</div>}
          </div>
          <label className="rail-search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search project"
              aria-label="Search project files"
            />
            {!query && <kbd>⌘K</kbd>}
            {query && <button type="button" aria-label="Clear project search" onClick={() => setQuery("")}><X size={11} /></button>}
          </label>
        </>
      ) : (
        <div className="syllabus-panel" role="tabpanel">
          <div className="syllabus-document"><FileCode2 size={13} /><span>{basename(activePath)}</span></div>
          <nav className="syllabus-list" aria-label="Document syllabus">
            {outline.map((item) => (
              <button
                type="button"
                key={`${item.line}-${item.title}`}
                className={item.line === activeOutlineLine ? "active" : ""}
                onClick={() => onSelectOutline(item.line)}
                style={{ paddingLeft: 11 + item.depth * 13 }}
                title={`\\${item.command} · line ${item.line}`}
              >
                <span className="syllabus-marker" />
                <span className="syllabus-title">{item.title}</span>
                <small>{item.line}</small>
              </button>
            ))}
            {!outline.length && <div className="syllabus-empty"><ListTree size={19} /><strong>No sections yet</strong><span>Add a \\section command to start the syllabus.</span></div>}
          </nav>
        </div>
      )}
    </aside>
  );
}

function Diagnostics({
  result,
  onSelect,
}: {
  result?: BuildResult;
  onSelect: (diagnostic: Diagnostic) => void;
}) {
  if (!result?.diagnostics.length) return null;
  return (
    <div className="diagnostics">
      <div className="diagnostic-title">
        <CircleAlert size={14} /> Build diagnostics
      </div>
      {result.diagnostics.slice(0, 6).map((diagnostic, index) => (
        <button key={`${diagnostic.line}-${index}`} onClick={() => onSelect(diagnostic)}>
          <span className={`severity-dot ${diagnostic.severity}`} />
          <span className="diagnostic-message">{diagnostic.message}</span>
          {diagnostic.line && <span className="diagnostic-line">line {diagnostic.line}</span>}
        </button>
      ))}
    </div>
  );
}

function PdfStage({
  result,
  building,
  root,
  rootDocument,
  syncTarget,
  onNavigate,
  onEditTable,
  onPrint,
  onOpenExternal,
  dockControl,
  onDockMouseDown,
}: {
  result?: BuildResult;
  building: boolean;
  root?: string;
  rootDocument?: string;
  syncTarget?: SyncTexPdfPosition;
  onNavigate: (page: number, x: number, y: number) => void;
  onEditTable: (page: number, x: number, y: number) => void;
  onPrint: () => void;
  onOpenExternal: () => void;
  dockControl?: ReactNode;
  onDockMouseDown?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const [zoom, setZoom] = useState(100);
  const hasPdf = Boolean(result?.success && result.pdfBase64);
  const loadPageImage = useMemo(() => {
    if (!root || !rootDocument || !result?.pdfVersion || !isDesktop()) return undefined;
    const version = result.pdfVersion;
    return (page: number) => renderPdfPage(root, rootDocument, version, page);
  }, [result?.pdfVersion, root, rootDocument]);

  return (
    <section className="preview-pane">
      <header className="pane-header pane-drag-surface" onMouseDown={onDockMouseDown}>
        <div className="pane-title">
          <span className="live-dot" /> Preview
          {hasPdf && <span className="synctex-hint">Ctrl/Cmd+click ↔ source · Shift+click edit table</span>}
        </div>
        <div className="preview-actions">
          <button className="icon-button" onClick={onPrint} aria-label="Print rendered PDF" title="Print rendered PDF" disabled={!hasPdf}>
            <Printer size={14} />
          </button>
          <button className="icon-button" onClick={onOpenExternal} aria-label="Open rendered PDF externally" title="Open rendered PDF in the default viewer" disabled={!hasPdf}>
            <ExternalLink size={14} />
          </button>
          <div className="page-controls">
            <button onClick={() => setZoom((value) => Math.max(60, value - 10))} aria-label="Zoom out" disabled={zoom <= 60}>−</button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((value) => Math.min(180, value + 10))} aria-label="Zoom in" disabled={zoom >= 180}>+</button>
          </div>
          {dockControl}
        </div>
      </header>
      <div className="preview-canvas">
        {building && (
          <div className="preview-loading"><LoaderCircle size={20} className="spin" /> Typesetting…</div>
        )}
        {result?.success && result.pdfBase64
          ? <PdfPreview pdfBase64={result.pdfBase64} zoom={zoom} target={syncTarget} onNavigate={onNavigate} onEditTable={onEditTable} loadPageImage={loadPageImage} />
          : null}
      </div>
    </section>
  );
}

function AiPanel({
  proposal,
  sourceBefore,
  loading,
  onAsk,
  onAccept,
  onReject,
  dockControl,
  onDockMouseDown,
}: {
  proposal?: AiProposal;
  sourceBefore: string;
  loading: boolean;
  onAsk: (prompt: string) => void;
  onAccept: () => void;
  onReject: () => void;
  dockControl?: ReactNode;
  onDockMouseDown?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const rows = proposal ? diffLines(sourceBefore, proposal.replacement) : [];
  const firstChange = rows.findIndex((row) => row.type !== "same");
  const lastChange = rows.reduce((found, row, index) => row.type !== "same" ? index : found, -1);
  const visibleRows = firstChange >= 0
    ? rows.slice(Math.max(0, firstChange - 2), Math.min(rows.length, lastChange + 3))
    : rows.slice(0, 8);

  const submit = () => {
    const next = prompt.trim();
    if (!next || loading) return;
    onAsk(next);
    setPrompt("");
  };

  return (
    <aside className="ai-panel">
      <div className="ai-heading pane-drag-surface" onMouseDown={onDockMouseDown}>
        <div className="ai-mark"><Sparkles size={14} /></div>
        <div><strong>Lattice AI</strong><span>Document-aware</span></div>
        <span className="beta-pill">LOCAL-FIRST</span>
        {dockControl}
      </div>

      <div className="ai-scroll">
        {!proposal && !loading && (
          <>
            <div className="ai-intro">
              <div className="orb"><WandSparkles size={21} /></div>
              <h3>What shall we improve?</h3>
              <p>Select text for a focused edit, or ask about the whole document. Every change arrives as a reviewable patch.</p>
            </div>
            <div className="quick-list">
              {QUICK_PROMPTS.map((item) => <button key={item} onClick={() => onAsk(item)}>{item}<span>↗</span></button>)}
            </div>
          </>
        )}
        {loading && (
          <div className="ai-thinking"><span className="thinking-orb"><Sparkles size={16} /></span><div><strong>Reading the document…</strong><p>Preparing a source-safe edit</p></div></div>
        )}
        {proposal && (
          <div className="proposal">
            <div className="proposal-label"><Sparkles size={13} /> Proposed edit <span>{proposal.mode}</span></div>
            <h3>{proposal.summary}</h3>
            <p>{proposal.explanation}</p>
            <div className="mini-diff">
              {visibleRows.slice(0, 18).map((row, index) => (
                <div className={row.type} key={`${index}-${row.text}`}><span>{row.type === "add" ? "+" : row.type === "remove" ? "−" : " "}</span>{row.text || " "}</div>
              ))}
            </div>
            <div className="proposal-actions">
              <button className="accept" onClick={onAccept}><Check size={14} /> Accept edit</button>
              <button onClick={onReject}><X size={14} /> Dismiss</button>
            </div>
          </div>
        )}
      </div>

      <div className="prompt-box">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
          }}
          placeholder="Ask Lattice to edit, explain, or repair…"
          rows={3}
        />
        <div><span>Uses selection + diagnostics</span><button onClick={submit} disabled={!prompt.trim() || loading}><Play size={13} fill="currentColor" /></button></div>
      </div>
    </aside>
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectSnapshot>(demoProject);
  const [projectSessions, setProjectSessions] = useState<ProjectSession[]>(() => [createProjectSession(demoProject)]);
  const [activePath, setActivePath] = useState("main.tex");
  const [source, setSource] = useState(demoSource);
  const [dirty, setDirty] = useState(false);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engine, setEngine] = useState<EngineId>("pdflatex");
  const [buildMode, setBuildMode] = useState<BuildMode>(initialBuildMode);
  const [building, setBuilding] = useState(false);
  const [projectReady, setProjectReady] = useState(!isDesktop());
  const [buildResult, setBuildResult] = useState<BuildResult>();
  const [syncTarget, setSyncTarget] = useState<SyncTexPdfPosition>();
  const [aiOpen, setAiOpen] = useState(true);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(initialWorkspaceLayout);
  const [draggingPane, setDraggingPane] = useState<WorkspacePaneId>();
  const [aiLoading, setAiLoading] = useState(false);
  const [proposal, setProposal] = useState<AiProposal>();
  const [proposalSelection, setProposalSelection] = useState<SelectionRange>();
  const [proposalBefore, setProposalBefore] = useState("");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tableEditor, setTableEditor] = useState<TableEditorState>();
  const [cursorLine, setCursorLine] = useState(1);
  const [notice, setNotice] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("saved");
  const [recentProjects, setRecentProjects] = useState(loadRecentProjects);
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [font, setFont] = useState<FontId>(initialFont);
  const [fontSize, setFontSize] = useState(initialFontSize);
  const [mathToolbarEnabled, setMathToolbarEnabled] = useState(initialMathToolbarEnabled);
  const [mathToolbarPosition, setMathToolbarPosition] = useState<ToolbarPosition>(initialMathToolbarPosition);
  const [customToolbarEnabled, setCustomToolbarEnabled] = useState(initialCustomToolbarEnabled);
  const [customToolbarPosition, setCustomToolbarPosition] = useState<ToolbarPosition>(initialCustomToolbarPosition);
  const [customCommands, setCustomCommands] = useState<UserCommand[]>(initialCustomCommands);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(initialSpellcheckEnabled);
  const [spellcheckDialect, setSpellcheckDialect] = useState<SpellcheckDialectId>(initialSpellcheckDialect);
  const [spellcheckStatus, setSpellcheckStatus] = useState<SpellcheckStatus>({
    phase: initialSpellcheckEnabled() ? "loading" : "disabled",
    issueCount: 0,
  });
  const [keybindings, setKeybindings] = useState<Keybindings>(initialKeybindings);
  const suppressDockClickRef = useRef(false);
  const editorRef = useRef<EditorController | null>(null);
  const mathSnippetRef = useRef(mathSnippet);
  mathSnippetRef.current = mathSnippet;
  const customCommandSnippetRef = useRef(customCommandSnippet);
  customCommandSnippetRef.current = customCommandSnippet;
  const forwardSearchRef = useRef<(line: number, column: number) => void>(() => undefined);
  const spellcheckRef = useRef<SpellcheckController | null>(null);
  const spellcheckMountGeneration = useRef(0);
  const sourceRef = useRef(demoSource);
  const savedSourceRef = useRef(demoSource);
  const dirtyRef = useRef(false);
  const sourceSyncTimer = useRef<number | undefined>(undefined);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const autosaveRef = useRef<() => void>(() => undefined);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const buildSchedulerRef = useRef<BuildScheduler | null>(null);
  const executeBuildRef = useRef<(request: BuildRequest) => Promise<void>>(async () => undefined);
  const buildModeRef = useRef(buildMode);
  buildModeRef.current = buildMode;
  const navigationGenerationRef = useRef(0);
  const activeDocumentRef = useRef("");
  activeDocumentRef.current = `${project.root}\0${activePath}`;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const projectSessionsRef = useRef(projectSessions);
  projectSessionsRef.current = projectSessions;
  const activeProjectSession = projectSessions.find((session) => session.project.root === project.root)
    ?? createProjectSession(project, activePath);
  const outline = useMemo(() => parseLatexOutline(source), [source]);
  const activeOutlineLine = useMemo(() => {
    let active: number | undefined;
    for (const item of outline) {
      if (item.line > cursorLine) break;
      active = item.line;
    }
    return active;
  }, [cursorLine, outline]);

  useEffect(() => {
    const scheduler = createBuildScheduler((request) => executeBuildRef.current(request));
    buildSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (buildSchedulerRef.current === scheduler) buildSchedulerRef.current = null;
    };
  }, []);

  useEffect(() => { detectEngines().then(setEngines).catch(console.error); }, []);
  useEffect(() => {
    let cancelled = false;
    updateLatexProjectFiles(project.files.map((file) => file.path));
    updateLatexProjectSources([]);
    if (project.root === demoProject.root) {
      updateLatexProjectSources([demoSource]);
      return undefined;
    }
    const sourceFiles = project.files.filter((file) => file.kind === "tex" || file.kind === "bib");
    Promise.all(sourceFiles.map((file) => readFile(project.root, file.path).catch(() => ""))).then((sources) => {
      if (!cancelled) updateLatexProjectSources(sources);
    });
    return () => { cancelled = true; };
  }, [project.files, project.root]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("lattice-theme", theme);
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = THEMES.find((item) => item.id === theme)?.browserColor ?? "#11120f";
  }, [theme]);
  useEffect(() => {
    window.localStorage.setItem("lattice-editor-font", font);
    window.localStorage.setItem("lattice-editor-font-size", String(fontSize));
  }, [font, fontSize]);
  useEffect(() => {
    window.localStorage.setItem("lattice-math-toolbar-enabled", String(mathToolbarEnabled));
    window.localStorage.setItem("lattice-math-toolbar-position", mathToolbarPosition);
  }, [mathToolbarEnabled, mathToolbarPosition]);
  useEffect(() => {
    window.localStorage.setItem("lattice-custom-toolbar-enabled", String(customToolbarEnabled));
    window.localStorage.setItem("lattice-custom-toolbar-position", customToolbarPosition);
    window.localStorage.setItem("lattice-custom-commands", JSON.stringify(customCommands));
  }, [customCommands, customToolbarEnabled, customToolbarPosition]);
  useEffect(() => {
    window.localStorage.setItem("lattice-spellcheck-enabled", String(spellcheckEnabled));
    window.localStorage.setItem("lattice-spellcheck-dialect", spellcheckDialect);
    spellcheckRef.current?.configure(spellcheckEnabled, spellcheckDialect);
  }, [spellcheckDialect, spellcheckEnabled]);
  useEffect(() => {
    window.localStorage.setItem("lattice-keybindings", JSON.stringify(keybindings));
  }, [keybindings]);
  useEffect(() => {
    window.localStorage.setItem("lattice-workspace-layout", JSON.stringify(workspaceLayout));
  }, [workspaceLayout]);
  useEffect(() => {
    window.localStorage.setItem("lattice-build-mode", buildMode);
    buildSchedulerRef.current?.invalidate();
    buildSchedulerRef.current?.setLiveEnabled(buildMode === "live");
    if (buildMode === "live" && projectReady) buildSchedulerRef.current?.scheduleLive();
  }, [buildMode, engine, project.root, project.rootDocument, projectReady]);
  useEffect(() => {
    storeRecentProjects(recentProjects);
    void updateNativeRecentProjects(recentProjects);
  }, [recentProjects]);
  useEffect(() => {
    if (!projectReady || !isDesktop()) return;
    storeWorkspaceSession(projectSessions, project.root);
  }, [project.root, projectReady, projectSessions]);
  useEffect(() => {
    setProjectSessions((current) => current.map((session) => session.project.root === project.root
      ? { ...session, project, activePath, buildResult, syncTarget }
      : session));
  }, [activePath, buildResult, project, syncTarget]);
  useEffect(() => () => {
    window.clearTimeout(sourceSyncTimer.current);
    window.clearTimeout(autosaveTimer.current);
  }, []);
  useEffect(() => () => {
    spellcheckMountGeneration.current += 1;
    spellcheckRef.current?.dispose();
    spellcheckRef.current = null;
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!draggingPane) return;
    const cancelDocking = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDraggingPane(undefined);
      document.body.classList.remove("dragging-pane");
    };
    window.addEventListener("keydown", cancelDocking, true);
    return () => window.removeEventListener("keydown", cancelDocking, true);
  }, [draggingPane]);

  const loadDocument = useCallback((content: string, documentKey?: string) => {
    window.clearTimeout(sourceSyncTimer.current);
    window.clearTimeout(autosaveTimer.current);
    buildSchedulerRef.current?.invalidate();
    if (documentKey) activeDocumentRef.current = documentKey;
    sourceRef.current = content;
    savedSourceRef.current = content;
    dirtyRef.current = false;
    editorRef.current?.replaceContent(content);
    setSource(content);
    setDirty(false);
    setSaveStatus("saved");
  }, []);

  const rememberProject = useCallback((next: ProjectSnapshot) => {
    setRecentProjects((current) => rememberRecentProject(current, { root: next.root, name: next.name }));
  }, []);

  const activateProject = useCallback(async (next: ProjectSnapshot, preferredPath?: string) => {
    const existing = projectSessionsRef.current.find((session) => session.project.root === next.root);
    const nextPath = preferredPath ?? existing?.activePath ?? next.rootDocument;
    if (project.root === next.root && activePath === nextPath) {
      setProject(next);
      setProjectSessions((current) => upsertProjectSession(current, next, nextPath));
      rememberProject(next);
      return true;
    }
    if (dirtyRef.current && !(await saveRef.current())) return false;
    const generation = ++navigationGenerationRef.current;
    try {
      const content = await readFile(next.root, nextPath);
      if (generation !== navigationGenerationRef.current) return false;
      setProjectSessions((current) => {
        const preserved = current.map((session) => session.project.root === project.root
          ? { ...session, project, activePath, buildResult, syncTarget }
          : session);
        return upsertProjectSession(preserved, next, nextPath);
      });
      setProject(next);
      setActivePath(nextPath);
      loadDocument(content, `${next.root}\0${nextPath}`);
      setBuildResult(existing?.buildResult);
      setSyncTarget(existing?.syncTarget);
      setProposal(undefined);
      rememberProject(next);
      return true;
    } catch (error) {
      if (generation === navigationGenerationRef.current) {
        setNotice(`Could not open ${next.name}: ${String(error)}`);
      }
      return false;
    }
  }, [activePath, buildResult, loadDocument, project, rememberProject, syncTarget]);

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    void (async () => {
      try {
        let restorationFailureMessage: string | undefined;
        const stored = loadWorkspaceSession();
        if (stored) {
          let failedProjects = 0;
          const restored = (await Promise.all(stored.projects.map(async (saved) => {
            try {
              const restoredProject = await readProject(saved.root);
              return {
                savedRoot: saved.root,
                session: reconcileStoredProjectSession(restoredProject, saved),
              };
            } catch {
              failedProjects += 1;
              return undefined;
            }
          }))).filter((entry): entry is { savedRoot: string; session: ProjectSession } => Boolean(entry));
          const preferred = restored.find((entry) => entry.savedRoot === stored.activeRoot);
          const ordered = preferred
            ? [preferred, ...restored.filter((entry) => entry !== preferred)]
            : restored;
          let selected: typeof preferred;
          let content: string | undefined;
          for (const candidate of ordered) {
            try {
              content = await readFile(candidate.session.project.root, candidate.session.activePath);
              selected = candidate;
              break;
            } catch {
              failedProjects += 1;
            }
          }
          if (selected && content !== undefined) {
            if (cancelled) return;
            const restoredSessions = restored.map((entry) => entry.session);
            setProject(selected.session.project);
            setActivePath(selected.session.activePath);
            setProjectSessions(restoredSessions);
            loadDocument(content, `${selected.session.project.root}\0${selected.session.activePath}`);
            restoredSessions.forEach((session) => rememberProject(session.project));
            if (failedProjects) {
              setNotice(`${failedProjects} item${failedProjects === 1 ? "" : "s"} from the previous session could not be reopened.`);
            }
            return;
          }
          restorationFailureMessage = "The previous session could not be reopened. Lattice opened the starter project instead.";
        }

        const initialProject = await readStarterProject();
        const content = await readFile(initialProject.root, initialProject.rootDocument);
        if (cancelled) return;
        setProject(initialProject);
        setActivePath(initialProject.rootDocument);
        setProjectSessions([createProjectSession(initialProject)]);
        loadDocument(content, `${initialProject.root}\0${initialProject.rootDocument}`);
        rememberProject(initialProject);
        if (restorationFailureMessage) setNotice(restorationFailureMessage);
      } catch (error) {
        if (!cancelled) setNotice(`Could not open the starter project: ${String(error)}`);
      } finally {
        if (!cancelled) setProjectReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [loadDocument, rememberProject]);

  const openProject = useCallback(async (): Promise<ProjectSnapshot | null> => {
    if (!projectReady) return null;
    if (!isDesktop()) {
      setNotice("Opening local folders is available in the desktop app. Browser mode uses the sample project.");
      return null;
    }
    const next = await chooseProject();
    if (!next) return null;
    return await activateProject(next) ? next : null;
  }, [activateProject, projectReady]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    const content = value ?? "";
    sourceRef.current = content;
    const isDirty = content !== savedSourceRef.current;
    if (dirtyRef.current !== isDirty) {
      dirtyRef.current = isDirty;
      setDirty(isDirty);
    }
    setSaveStatus("idle");
    buildSchedulerRef.current?.noteEdit();

    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => autosaveRef.current(), 1000);

    // Monaco owns its live model. React only receives a quiet snapshot for
    // outline/AI work, avoiding a full four-pane render on every keystroke.
    window.clearTimeout(sourceSyncTimer.current);
    sourceSyncTimer.current = window.setTimeout(() => setSource(content), 220);
  }, []);

  const save = useCallback(async () => {
    if (!projectReady) return false;
    if (isDesktop() && project.root === demoProject.root) {
      setNotice("Open a local project before saving.");
      return false;
    }
    const content = sourceRef.current;
    const documentKey = `${project.root}\0${activePath}`;
    setSaveStatus("saving");
    try {
      await writeFile(project.root, activePath, content);
      if (activeDocumentRef.current !== documentKey) return true;
      savedSourceRef.current = content;
      const stillDirty = sourceRef.current !== content;
      dirtyRef.current = stillDirty;
      setSource(sourceRef.current);
      setDirty(stillDirty);
      setSaveStatus(stillDirty ? "idle" : "saved");
      return true;
    } catch (error) {
      setSaveStatus("error");
      setNotice(`Could not save ${basename(activePath)}: ${String(error)}`);
      return false;
    }
  }, [activePath, project.root, projectReady]);
  saveRef.current = save;
  autosaveRef.current = () => {
    if (dirtyRef.current) void save();
  };

  useEffect(() => {
    const flushAutosave = () => {
      if (dirtyRef.current) autosaveRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    window.addEventListener("blur", flushAutosave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", flushAutosave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const saveAs = useCallback(async () => {
    if (!projectReady) return;
    if (!isDesktop()) {
      setNotice("Save As is available in the desktop app.");
      return;
    }
    try {
      const content = sourceRef.current;
      const result = await saveFileAs(project.root, activePath, project.rootDocument, content);
      if (!result) return;
      setProjectSessions((current) => {
        const preserved = current.map((session) => session.project.root === project.root
          ? { ...session, project, activePath, buildResult, syncTarget }
          : session);
        return upsertProjectSession(preserved, result.project, result.path);
      });
      setProject(result.project);
      setActivePath(result.path);
      loadDocument(content, `${result.project.root}\0${result.path}`);
      rememberProject(result.project);
      setBuildResult(undefined);
      setSyncTarget(undefined);
      setNotice(`Saved as ${basename(result.path)}`);
    } catch (error) {
      setNotice(`Could not save a copy: ${String(error)}`);
    }
  }, [activePath, buildResult, loadDocument, project, projectReady, rememberProject, syncTarget]);

  const openRecentProject = useCallback(async (root: string) => {
    if (!projectReady) return;
    try {
      const next = await readProject(root);
      await activateProject(next);
    } catch (error) {
      setRecentProjects((current) => current.filter((item) => item.root !== root));
      setNotice(`Could not open the recent project: ${String(error)}`);
    }
  }, [activateProject, projectReady]);

  const openRenderedPdf = useCallback(async () => {
    if (!buildResult?.success || !buildResult.pdfBase64) {
      setNotice("Build the document before opening its PDF.");
      return;
    }
    try {
      await openBuiltPdf(project.root, project.rootDocument);
    } catch (error) {
      setNotice(`Could not open the rendered PDF: ${String(error)}`);
    }
  }, [buildResult, project.root, project.rootDocument]);

  const printRenderedPdf = useCallback(async () => {
    if (!buildResult?.success || !buildResult.pdfBase64) {
      setNotice("Build the document before printing it.");
      return;
    }
    try {
      await printBuiltPdf(project.root, project.rootDocument);
    } catch (error) {
      setNotice(`Could not print the rendered PDF: ${String(error)}`);
    }
  }, [buildResult, project.root, project.rootDocument]);

  useEffect(() => subscribeToDesktopMenu((action, payload) => {
    if (action === "open-project") void openProject();
    else if (action === "open-recent" && payload) void openRecentProject(payload);
    else if (action === "save") void save();
    else if (action === "save-as") void saveAs();
    else if (action === "print-pdf") void printRenderedPdf();
    else if (action === "open-pdf") void openRenderedPdf();
  }), [openProject, openRecentProject, openRenderedPdf, printRenderedPdf, save, saveAs]);

  const executeBuild = useCallback(async (request: BuildRequest) => {
    if (!projectReady) return;
    let buildProject = project;
    let revision = request.revision;
    if (isDesktop() && project.root === demoProject.root) {
      if (request.kind === "live") return;
      const selectedProject = await openProject();
      if (!selectedProject) return;
      buildProject = selectedProject;
      revision = buildSchedulerRef.current?.currentRevision() ?? revision;
    }

    setBuilding(true);
    let documentKey = activeDocumentRef.current;
    try {
      if (buildProject === project && dirtyRef.current && !(await save())) return;
      documentKey = activeDocumentRef.current;
      const result = await compileProject(
        buildProject.root,
        buildProject.rootDocument,
        engine,
        request.kind === "live",
      );
      const isCurrent = activeDocumentRef.current === documentKey
        && (buildSchedulerRef.current?.isCurrent(revision) ?? true);
      if (isCurrent) {
        setBuildResult(result);
        setSyncTarget(undefined);
      }
    } catch (error) {
      const isCurrent = activeDocumentRef.current === documentKey
        && (buildSchedulerRef.current?.isCurrent(revision) ?? true);
      if (request.kind === "live") {
        setBuildMode("on-demand");
        setNotice(`Live preview paused after a build failure: ${String(error)}`);
      }
      if (isCurrent) {
        setBuildResult({ success: false, durationMs: 0, engine, diagnostics: [{ severity: "error", message: String(error) }], log: String(error) });
      }
    } finally {
      setBuilding(false);
    }
  }, [activePath, engine, openProject, project, projectReady, save]);
  executeBuildRef.current = executeBuild;

  const build = useCallback(() => {
    const scheduler = buildSchedulerRef.current;
    if (scheduler) scheduler.requestManual();
    else void executeBuild({ kind: "manual", revision: 0 });
  }, [executeBuild]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      const hotkey = hotkeyFromEvent(event);
      const customCommandIndex = customCommandIndexFromKeyboardEvent(event);
      if (customCommandIndex !== undefined) {
        const command = customCommands[customCommandIndex];
        if (!activePath.endsWith(".bib") && command?.template.trim()) {
          event.preventDefault();
          event.stopPropagation();
          editorRef.current?.insertCustomCommand(command.template);
          return;
        }
      }
      if (hotkey === keybindings.build) {
        event.preventDefault();
        event.stopPropagation();
        void build();
        return;
      }
      if (editorRef.current?.hasTextFocus() && hotkey === keybindings.deleteLine) {
        event.preventDefault();
        event.stopPropagation();
        editorRef.current.deleteCurrentLine();
        return;
      }
      if (editorRef.current?.hasTextFocus() && hotkey === keybindings.toggleComment) {
        event.preventDefault();
        event.stopPropagation();
        editorRef.current.toggleLineComment();
        return;
      }
      if (editorRef.current?.hasTextFocus() && (event.ctrlKey || event.metaKey) && !event.altKey) {
        const format = event.key.toLowerCase() === "b"
          ? "bold"
          : event.key.toLowerCase() === "i"
            ? "italic"
            : event.key.toLowerCase() === "u"
              ? "underline"
              : undefined;
        if (format) {
          event.preventDefault();
          event.stopPropagation();
          editorRef.current.applyFormatting(format);
          return;
        }
      }
      if (!isDesktop()) {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveAs(); }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); void openProject(); }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); void printRenderedPdf(); }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void build(); }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") { event.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [activePath, build, customCommands, keybindings, openProject, printRenderedPdf, save, saveAs, settingsOpen]);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const changeKeybinding = useCallback((action: HotkeyAction, hotkey: string) => {
    setKeybindings((current) => {
      const duplicate = (Object.keys(current) as HotkeyAction[]).find((item) => item !== action && current[item] === hotkey);
      if (!duplicate) return { ...current, [action]: hotkey };
      return { ...current, [action]: hotkey, [duplicate]: current[action] };
    });
  }, []);
  const changeCustomCommand = useCallback((index: number, patch: Partial<UserCommand>) => {
    setCustomCommands((current) => current.map((command, commandIndex) =>
      commandIndex === index ? { ...command, ...patch } : command,
    ));
  }, []);
  const resetSettings = useCallback(() => {
    setTheme("lattice");
    setFont("jetbrains");
    setFontSize(13.5);
    setMathToolbarEnabled(true);
    setMathToolbarPosition("top");
    setCustomToolbarEnabled(true);
    setCustomToolbarPosition("top");
    setCustomCommands(defaultUserCommands());
    setBuildMode("on-demand");
    setSpellcheckEnabled(true);
    setSpellcheckDialect("british");
    setKeybindings({ ...DEFAULT_KEYBINDINGS });
    setWorkspaceLayout(workspaceLayoutFromStorage(null));
  }, []);

  const openFilePath = async (path: string) => {
    if (path === activePath) {
      setProjectSessions((current) => openSessionFile(current, project.root, path));
      return true;
    }
    if (dirtyRef.current && !(await save())) return false;
    const generation = ++navigationGenerationRef.current;
    try {
      const content = await readFile(project.root, path);
      if (generation !== navigationGenerationRef.current) return false;
      setProjectSessions((current) => openSessionFile(current, project.root, path));
      setActivePath(path);
      loadDocument(content, `${project.root}\0${path}`);
      setProposal(undefined);
      return true;
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNotice(`Could not open ${basename(path)}: ${String(error)}`);
      return false;
    }
  };

  const openFile = async (file: ProjectFile) => {
    if (file.kind === "image") {
      setNotice("Image preview will be added in the next authoring milestone.");
      return;
    }
    await openFilePath(file.path);
  };

  const closeFileTab = async (path: string) => {
    const session = projectSessionsRef.current.find((candidate) => candidate.project.root === project.root);
    if (!session || session.openPaths.length <= 1 || !session.openPaths.includes(path)) return;
    if (path !== activePath) {
      setProjectSessions((current) => closeSessionFile(current, project.root, path).sessions);
      return;
    }
    if (dirtyRef.current && !(await save())) return;
    const closed = closeSessionFile(projectSessionsRef.current, project.root, path);
    if (!closed.nextPath) return;
    const generation = ++navigationGenerationRef.current;
    try {
      const content = await readFile(project.root, closed.nextPath);
      if (generation !== navigationGenerationRef.current) return;
      setProjectSessions(closed.sessions);
      setActivePath(closed.nextPath);
      loadDocument(content, `${project.root}\0${closed.nextPath}`);
      setProposal(undefined);
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNotice(`Could not close ${basename(path)}: ${String(error)}`);
    }
  };

  const closeProjectTab = async (root: string) => {
    const sessions = projectSessionsRef.current;
    if (sessions.length <= 1 || !sessions.some((session) => session.project.root === root)) return;
    if (root !== project.root) {
      setProjectSessions(closeProjectSession(sessions, root).sessions);
      return;
    }
    if (dirtyRef.current && !(await save())) return;
    const closed = closeProjectSession(sessions, root);
    const next = closed.sessions.find((session) => session.project.root === closed.nextRoot);
    if (!next) return;
    const generation = ++navigationGenerationRef.current;
    try {
      const content = await readFile(next.project.root, next.activePath);
      if (generation !== navigationGenerationRef.current) return;
      setProjectSessions(closed.sessions);
      setProject(next.project);
      setActivePath(next.activePath);
      loadDocument(content, `${next.project.root}\0${next.activePath}`);
      setBuildResult(next.buildResult);
      setSyncTarget(next.syncTarget);
      setProposal(undefined);
    } catch (error) {
      if (generation === navigationGenerationRef.current) setNotice(`Could not close ${project.name}: ${String(error)}`);
    }
  };

  const runForwardSearch = useCallback(async (line: number, column: number) => {
    if (!isDesktop()) {
      setNotice("SyncTeX navigation is available in the desktop app after a build.");
      return;
    }
    if (dirtyRef.current) {
      setNotice("Build the document to refresh its SyncTeX map, then Ctrl+click again.");
      return;
    }
    if (!buildResult?.success || !buildResult.pdfBase64) {
      setNotice("Build the document before using Ctrl+click navigation.");
      return;
    }
    try {
      setSyncTarget(await forwardSearch(project.root, project.rootDocument, activePath, line, column));
    } catch (error) {
      setNotice(String(error));
    }
  }, [activePath, buildResult, project.root, project.rootDocument]);
  forwardSearchRef.current = (line, column) => { void runForwardSearch(line, column); };

  const runInverseSearch = useCallback(async (page: number, x: number, y: number) => {
    if (!isDesktop()) {
      setNotice("SyncTeX navigation is available in the desktop app after a build.");
      return;
    }
    try {
      const position = await inverseSearch(project.root, project.rootDocument, page, x, y);
      const file = project.files.find((item) => item.path === position.path);
      if (!file) throw new Error(`SyncTeX points to ${position.path}, which is not in the project file list.`);
      if (position.path !== activePath) await openFile(file);
      window.requestAnimationFrame(() => {
        editorRef.current?.revealPosition(position.line, position.column);
      });
    } catch (error) {
      setNotice(String(error));
    }
  }, [activePath, openFile, project.files, project.root, project.rootDocument]);

  const runInverseTableEdit = useCallback(async (page: number, x: number, y: number) => {
    if (!isDesktop()) {
      setNotice("Editing a table from the PDF is available in the desktop app after a build.");
      return;
    }
    if (dirtyRef.current) {
      setNotice("Build the document to refresh its SyncTeX map, then Shift+click the table again.");
      return;
    }
    if (!buildResult?.success || !buildResult.pdfBase64) {
      setNotice("Build the document before editing a table from the PDF.");
      return;
    }
    try {
      const position = await inverseSearch(project.root, project.rootDocument, page, x, y);
      const file = project.files.find((item) => item.path === position.path);
      if (!file) throw new Error(`SyncTeX points to ${position.path}, which is not in the project file list.`);
      if (position.path !== activePath) await openFile(file);
      window.requestAnimationFrame(() => {
        editorRef.current?.openTableAt(position.line, position.column, position.path);
      });
    } catch (error) {
      setNotice(String(error));
    }
  }, [activePath, buildResult, openFile, project.files, project.root, project.rootDocument]);

  const runAi = async (prompt: string) => {
    setAiOpen(true);
    setAiLoading(true);
    setProposal(undefined);
    const selectionRange = editorRef.current?.getSelection();
    const currentSource = sourceRef.current;
    const before = selectionRange?.text ?? currentSource;
    setProposalSelection(selectionRange);
    setProposalBefore(before);
    try {
      setProposal(await askAi({ root: project.root, path: activePath, source: currentSource, prompt, selection: selectionRange, diagnostics: buildResult?.diagnostics ?? [] }));
    } catch (error) {
      setProposal({ summary: "AI request could not be completed", explanation: String(error), replacement: before, mode: "demo" });
    } finally {
      setAiLoading(false);
    }
  };

  const acceptProposal = () => {
    if (!proposal) return;
    if (editorRef.current) {
      editorRef.current.replaceSelection(proposalSelection, proposal.replacement);
    } else {
      const content = replaceSelection(sourceRef.current, proposalSelection, proposal.replacement);
      sourceRef.current = content;
      setSource(content);
      dirtyRef.current = content !== savedSourceRef.current;
      setDirty(dirtyRef.current);
      buildSchedulerRef.current?.noteEdit();
    }
    setProposal(undefined);
    editorRef.current?.focus();
  };

  const selectDiagnostic = (diagnostic: Diagnostic) => {
    if (!diagnostic.line || !editorRef.current) return;
    editorRef.current.revealLine(diagnostic.line);
  };

  const selectOutlineItem = (line: number) => {
    editorRef.current?.revealLine(line);
    setOutlineOpen(false);
  };

  const mountMonacoEditor = useCallback<OnMount>((editor: MonacoEditor, monaco) => {
    const mountGeneration = ++spellcheckMountGeneration.current;
    loadEditorDocument(editor, sourceRef.current);
    const scriptBraces = registerScriptBraces(editor, monaco);
    editor.onDidDispose(() => scriptBraces.dispose());
    setCursorLine(editor.getPosition()?.lineNumber ?? 1);
    editor.onDidChangeCursorPosition((event) => setCursorLine(event.position.lineNumber));
    const applyFormatting = (format: EditorFormat) => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection) return;

      const line = selection.positionLineNumber;
      const editRange = selection.isEmpty() && formatUsesCurrentLine(format)
        ? new monaco.Selection(line, 1, line, model.getLineMaxColumn(line))
        : selection;

      const selectedText = model.getValueInRange(editRange);
      const edit = createFormattingEdit(format, selectedText);
      const startOffset = model.getOffsetAt(editRange.getStartPosition());
      editor.pushUndoStop();
      editor.executeEdits("lattice-formatting-toolbar", [{ range: editRange, text: edit.text, forceMoveMarkers: true }]);
      editor.pushUndoStop();

      const selectionStart = model.getPositionAt(startOffset + edit.selectionStart);
      const selectionEnd = model.getPositionAt(startOffset + edit.selectionEnd);
      editor.setSelection({
        startLineNumber: selectionStart.lineNumber,
        startColumn: selectionStart.column,
        endLineNumber: selectionEnd.lineNumber,
        endColumn: selectionEnd.column,
      });
      editor.revealRangeInCenterIfOutsideViewport(editor.getSelection()!);
      editor.focus();
    };
    const selectedEditorText = () => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      return selection && model && !selection.isEmpty() ? model.getValueInRange(selection) : "";
    };
    const insertSnippet = (snippet: string, description: string) => {
      editor.focus();
      const snippetController = editor.getContribution("snippetController2") as unknown as {
        insert: (value: string) => void;
      } | null;
      if (!snippetController) {
        setNotice("The editor snippet controller is unavailable. Reload the editor and try again.");
        return;
      }
      try {
        snippetController.insert(snippet);
      } catch (error) {
        setNotice(`Could not insert ${description}: ${String(error)}`);
      }
    };
    const insertText = (text: string, editSource: string) => {
      insertEditorText(editor, text, editSource);
    };
    const insertTable = (text: string, requiredPackages: string[], requestedSelection?: SelectionRange) => {
      const model = editor.getModel();
      const selection = requestedSelection
        ? new monaco.Range(requestedSelection.startLine, requestedSelection.startColumn, requestedSelection.endLine, requestedSelection.endColumn)
        : editor.getSelection();
      if (!model || !selection) return [];
      const preambleInsertion = createLatexPreambleInsertion(model.getValue(), requiredPackages);
      const edits = [{ range: selection, text, forceMoveMarkers: true }];
      if (preambleInsertion) {
        const position = model.getPositionAt(preambleInsertion.offset);
        if (position.lineNumber === selection.startLineNumber && position.column === selection.startColumn) {
          edits[0].text = `${preambleInsertion.text}${text}`;
        } else {
          edits.push({
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            text: preambleInsertion.text,
            forceMoveMarkers: true,
          });
        }
      }
      editor.pushUndoStop();
      editor.executeEdits("lattice-table-editor", edits);
      editor.pushUndoStop();
      editor.focus();
      return preambleInsertion?.addedPackages ?? [];
    };
    const openTableAt = (line: number, column: number, path = activePathRef.current) => {
      const model = editor.getModel();
      if (!model) return false;
      const position = model.validatePosition({ lineNumber: line, column });
      const result = parseLatexTableAt(model.getValue(), model.getOffsetAt(position));
      if (!result.table) {
        setNotice(result.error);
        return false;
      }
      const start = model.getPositionAt(result.table.startOffset);
      const end = model.getPositionAt(result.table.endOffset);
      const selection: SelectionRange = {
        startLine: start.lineNumber,
        startColumn: start.column,
        endLine: end.lineNumber,
        endColumn: end.column,
        text: model.getValue().slice(result.table.startOffset, result.table.endOffset),
      };
      editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
      setTableEditor({ mode: "edit", initialTable: result.table.options, selection, path });
      return true;
    };
    editor.onMouseDown((event) => {
      if (!event.target.position) return;
      if (event.event.shiftKey && (event.event.ctrlKey || event.event.metaKey)) {
        event.event.preventDefault();
        event.event.stopPropagation();
        openTableAt(event.target.position.lineNumber, event.target.position.column);
        return;
      }
      if (!(event.event.ctrlKey || event.event.metaKey)) return;
      event.event.preventDefault();
      event.event.stopPropagation();
      forwardSearchRef.current(event.target.position.lineNumber, event.target.position.column);
    });
    const convertSpreadsheetPaste = (event: ClipboardEvent) => {
      if (!editor.hasTextFocus() || activePathRef.current.endsWith(".bib")) return;
      if (handleSmartTablePaste(event, (latex) => insertText(latex, "lattice-spreadsheet-paste"))) {
        setNotice("Spreadsheet cells pasted as a LaTeX table.");
      }
    };
    document.addEventListener("paste", convertSpreadsheetPaste, true);
    editor.onDidDispose(() => document.removeEventListener("paste", convertSpreadsheetPaste, true));
    editorRef.current = {
      focus: () => editor.focus(),
      undo: () => { editor.trigger("toolbar", "undo", null); editor.focus(); },
      redo: () => { editor.trigger("toolbar", "redo", null); editor.focus(); },
      replaceContent: (content) => {
        loadEditorDocument(editor, content);
      },
      replaceSelection: (selection, replacement) => {
        const model = editor.getModel();
        if (!model) return;
        const range = selection
          ? new monaco.Range(selection.startLine, selection.startColumn, selection.endLine, selection.endColumn)
          : model.getFullModelRange();
        editor.pushUndoStop();
        editor.executeEdits("lattice-ai-edit", [{ range, text: replacement, forceMoveMarkers: true }]);
        editor.pushUndoStop();
      },
      insertText: (text) => insertText(text, "lattice-table-editor"),
      insertTable,
      openTableAt,
      applyFormatting,
      insertMath: (command) => insertSnippet(
        mathSnippetRef.current(command, selectedEditorText()),
        "this maths command",
      ),
      insertCustomCommand: (template) => insertSnippet(
        customCommandSnippetRef.current(template, selectedEditorText()),
        "this custom command",
      ),
      hasTextFocus: () => editor.hasTextFocus(),
      deleteCurrentLine: () => editor.trigger("keyboard", "editor.action.deleteLines", null),
      toggleLineComment: () => editor.trigger("keyboard", "editor.action.commentLine", null),
      getSelection: () => {
        const selection = editor.getSelection();
        const model = editor.getModel();
        if (!selection || !model || selection.isEmpty()) return undefined;
        return {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
          text: model.getValueInRange(selection),
        };
      },
      revealLine: (line) => {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      },
      revealPosition: (line, column) => {
        const model = editor.getModel();
        if (!model) return;
        const position = model.validatePosition({ lineNumber: line, column });
        editor.revealPositionInCenter(position);
        editor.setPosition(position);
        editor.focus();
      },
    };
    void import("./spellcheck").then(({ createSpellcheckController }) => {
      if (mountGeneration !== spellcheckMountGeneration.current) return;
      spellcheckRef.current?.dispose();
      spellcheckRef.current = createSpellcheckController(
        monaco,
        editor,
        spellcheckEnabled,
        spellcheckDialect,
        setSpellcheckStatus,
      );
    }).catch((error) => {
      setSpellcheckStatus({ phase: "error", issueCount: 0, message: String(error) });
    });
  }, [spellcheckDialect, spellcheckEnabled]);

  const panesInZone = (zone: DockZone) => WORKSPACE_PANES
    .filter((pane) => (pane !== "ai" || aiOpen) && dockZone(workspaceLayout.placements[pane]) === zone)
    .sort((left, right) => DOCK_SLOTS.indexOf(workspaceLayout.placements[left]) - DOCK_SLOTS.indexOf(workspaceLayout.placements[right]));
  const leftPanes = panesInZone("left");
  const centerPanes = panesInZone("center");
  const rightPanes = panesInZone("right");
  const bottomPanes = panesInZone("bottom");
  const workspaceStyle: CSSProperties = {
    gridTemplateColumns: `${leftPanes.length ? `min(${workspaceLayout.sizes.left}px, 24vw)` : "0px"} minmax(300px, 1fr) ${rightPanes.length ? `min(${workspaceLayout.sizes.right}px, 36vw)` : "0px"}`,
    gridTemplateRows: `minmax(260px, 1fr) ${bottomPanes.length ? `min(${workspaceLayout.sizes.bottom}px, 42vh)` : "0px"}`,
  };
  const movePane = (pane: WorkspacePaneId, slot: DockSlot) => {
    setWorkspaceLayout((current) => moveWorkspacePane(current, pane, slot));
  };
  const beginPaneDrag = (pane: WorkspacePaneId, event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const interactive = (event.target as HTMLElement).closest("button, input, textarea, select, a");
    const directHandle = (event.currentTarget as HTMLElement).classList.contains("pane-drag-handle");
    if (interactive && !directHandle) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const move = (moveEvent: MouseEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      if (!active) {
        active = true;
        if (directHandle) suppressDockClickRef.current = true;
        document.body.classList.add("dragging-pane");
        setDraggingPane(pane);
      }
    };
    const stop = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("dragging-pane");
      if (active) {
        const target = document.elementFromPoint?.(upEvent.clientX, upEvent.clientY)?.closest<HTMLElement>("[data-dock-slot]");
        const slot = target?.dataset.dockSlot as DockSlot | undefined;
        if (slot && DOCK_SLOTS.includes(slot)) movePane(pane, slot);
        setDraggingPane(undefined);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };
  const dockControl = (pane: WorkspacePaneId, title: string) => (
    <PaneDragAffordance
      title={title}
      onMouseDown={(event) => beginPaneDrag(pane, event)}
      onActivate={() => {
        if (suppressDockClickRef.current) {
          suppressDockClickRef.current = false;
          return;
        }
        setDraggingPane((current) => current === pane ? undefined : pane);
      }}
    />
  );
  const editorPane = (
    <section className="editor-pane">
      <header className="pane-header editor-tabs pane-drag-surface" onMouseDown={(event) => beginPaneDrag("editor", event)}>
        <WorkspaceTabs
          ariaLabel="Open files"
          className="file-tabs"
          items={activeProjectSession.openPaths.map((path) => ({
            id: path,
            label: basename(path),
            accessibleLabel: path === basename(path) ? path : `${basename(path)} (${path})`,
            title: path,
            dirty: path === activePath && dirty,
          }))}
          activeId={activePath}
          onActivate={(path) => { void openFilePath(path); }}
          onClose={(path) => { void closeFileTab(path); }}
        />
        <div className="pane-heading-actions">
          <button
            className={`icon-button ${outlineOpen ? "active" : ""}`}
            title="Document outline"
            aria-label="Toggle document outline"
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((value) => !value)}
          ><Folder size={14} /></button>
          {dockControl("editor", "Editor")}
        </div>
      </header>
      {outlineOpen && (
        <div className="outline-popover">
          <div className="outline-title">Document outline</div>
          {outline.length ? outline.map((item) => (
            <button
              key={`${item.line}-${item.title}`}
              style={{ paddingLeft: 8 + item.depth * 12 }}
              onClick={() => selectOutlineItem(item.line)}
            >
              <span>{item.title}</span><small>{item.line}</small>
            </button>
          )) : <p>No sections in this file</p>}
        </div>
      )}
      <EditorToolbar
        disabled={activePath.endsWith(".bib")}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        onFormat={(format) => editorRef.current?.applyFormatting(format)}
        onInsertTable={() => setTableEditor({ mode: "insert" })}
      />
      {mathToolbarEnabled && mathToolbarPosition === "top" && (
        <MathToolbar
          disabled={activePath.endsWith(".bib")}
          position="top"
          onInsert={(command) => editorRef.current?.insertMath(command)}
        />
      )}
      {customToolbarEnabled && customToolbarPosition === "top" && (
        <CustomToolbar
          commands={customCommands}
          disabled={activePath.endsWith(".bib")}
          position="top"
          onInsert={(template) => editorRef.current?.insertCustomCommand(template)}
        />
      )}
      <div className="editor-body">
        {mathToolbarEnabled && mathToolbarPosition === "left" && (
          <MathToolbar
            disabled={activePath.endsWith(".bib")}
            position="left"
            onInsert={(command) => editorRef.current?.insertMath(command)}
          />
        )}
        {customToolbarEnabled && customToolbarPosition === "left" && (
          <CustomToolbar
            commands={customCommands}
            disabled={activePath.endsWith(".bib")}
            position="left"
            onInsert={(template) => editorRef.current?.insertCustomCommand(template)}
          />
        )}
        <div className="editor-wrap">
          {/* Monaco owns live text. A controlled value can replay a stale render and move the caret. */}
          <Editor
            language={activePath.endsWith(".bib") ? "bibtex" : "latex"}
            defaultValue={source}
            onChange={handleEditorChange}
            onMount={mountMonacoEditor}
            theme={THEMES.find((item) => item.id === theme)?.monaco ?? "lattice-dark"}
            beforeMount={configureMonaco}
            options={{
              minimap: { enabled: false }, fontFamily: FONT_OPTIONS.find((item) => item.id === font)?.family ?? FONT_OPTIONS[0].family, fontSize,
              lineHeight: Math.round(fontSize * 1.63), padding: { top: 18, bottom: 18 }, scrollBeyondLastLine: false,
              wordWrap: "on", folding: true, glyphMargin: false, renderLineHighlight: "line", smoothScrolling: false,
              cursorSmoothCaretAnimation: "off",
              quickSuggestions: { other: true, comments: false, strings: false }, suggestOnTriggerCharacters: true,
              snippetSuggestions: "top", tabCompletion: "on", parameterHints: { enabled: true }, wordBasedSuggestions: "off",
              overviewRulerBorder: false, hideCursorInOverviewRuler: true, automaticLayout: true,
            }}
          />
        </div>
        {customToolbarEnabled && customToolbarPosition === "right" && (
          <CustomToolbar
            commands={customCommands}
            disabled={activePath.endsWith(".bib")}
            position="right"
            onInsert={(template) => editorRef.current?.insertCustomCommand(template)}
          />
        )}
        {mathToolbarEnabled && mathToolbarPosition === "right" && (
          <MathToolbar
            disabled={activePath.endsWith(".bib")}
            position="right"
            onInsert={(command) => editorRef.current?.insertMath(command)}
          />
        )}
      </div>
      {mathToolbarEnabled && mathToolbarPosition === "bottom" && (
        <MathToolbar
          disabled={activePath.endsWith(".bib")}
          position="bottom"
          onInsert={(command) => editorRef.current?.insertMath(command)}
        />
      )}
      {customToolbarEnabled && customToolbarPosition === "bottom" && (
        <CustomToolbar
          commands={customCommands}
          disabled={activePath.endsWith(".bib")}
          position="bottom"
          onInsert={(template) => editorRef.current?.insertCustomCommand(template)}
        />
      )}
      <Diagnostics result={buildResult} onSelect={selectDiagnostic} />
    </section>
  );
  const renderPane = (pane: WorkspacePaneId, zone: DockZone, index: number, count: number) => {
    const split = workspaceLayout.splits[zone];
    const style: CSSProperties = count === 2
      ? { flexGrow: index === 0 ? split : 100 - split, flexBasis: 0 }
      : { flex: 1 };
    return (
      <div
        className="dock-pane"
        data-pane-id={pane}
        data-dock-slot={workspaceLayout.placements[pane]}
        style={style}
        key={pane}
      >
        {pane === "editor" && editorPane}
        {pane === "navigator" && (
          <FileRail
            project={project}
            activePath={activePath}
            outline={outline}
            activeOutlineLine={activeOutlineLine}
            onOpen={openFile}
            onOpenProject={openProject}
            onSelectOutline={selectOutlineItem}
            dockControl={dockControl("navigator", "Navigator")}
            onDockMouseDown={(event) => beginPaneDrag("navigator", event)}
          />
        )}
        {pane === "preview" && (
          <PdfStage
            result={buildResult}
            building={building}
            root={project.root}
            rootDocument={project.rootDocument}
            syncTarget={syncTarget}
            onNavigate={runInverseSearch}
            onEditTable={runInverseTableEdit}
            onPrint={() => { void printRenderedPdf(); }}
            onOpenExternal={() => { void openRenderedPdf(); }}
            dockControl={dockControl("preview", "Preview")}
            onDockMouseDown={(event) => beginPaneDrag("preview", event)}
          />
        )}
        {pane === "ai" && (
          <AiPanel
            proposal={proposal}
            sourceBefore={proposalBefore}
            loading={aiLoading}
            onAsk={runAi}
            onAccept={acceptProposal}
            onReject={() => setProposal(undefined)}
            dockControl={dockControl("ai", "Lattice AI")}
            onDockMouseDown={(event) => beginPaneDrag("ai", event)}
          />
        )}
      </div>
    );
  };
  const renderDockZone = (zone: DockZone, panes: WorkspacePaneId[]) => {
    if (!panes.length) return null;
    return (
      <div className={`dock-zone dock-zone-${zone} ${panes.length === 2 ? "split" : ""}`} data-dock-zone={zone}>
        {panes.map((pane, index) => (
          <Fragment key={pane}>
            {index > 0 && (
              <DockSplitHandle
                zone={zone}
                value={workspaceLayout.splits[zone]}
                onChange={(value) => setWorkspaceLayout((current) => resizeDockSplit(current, zone, value))}
              />
            )}
            {renderPane(pane, zone, index, panes.length)}
          </Fragment>
        ))}
      </div>
    );
  };

  const status = building
    ? "Typesetting document"
    : !projectReady
      ? "Opening project"
    : buildResult?.success
      ? `Built in ${(buildResult.durationMs / 1000).toFixed(1)}s`
      : buildResult
        ? "Build needs attention"
        : isDesktop() && project.root === demoProject.root
          ? "Open a project to build"
          : buildMode === "live"
            ? "Live preview ready"
            : isDesktop() ? "Ready to build" : "Interactive preview";

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-glyph">λ</span>
          <span className="brand-name">Lattice</span>
        </div>
        <div className="document-title">
          <span>{project.name}</span><span>/</span><strong>{basename(activePath)}</strong>{dirty && <i />}
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => { void save(); }} disabled={!dirty || !projectReady}><Save size={14} /> Save</button>
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} aria-label="LaTeX engine">
            {(engines.length ? engines : [{ id: "pdflatex", label: "pdfLaTeX", available: true } as EngineInfo]).map((item) => (
              <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " — unavailable"}</option>
            ))}
          </select>
          <button className="build-button" onClick={build} disabled={building || !projectReady} title={`Build now (${keybindings.build})`}><Hammer size={14} /> {building ? "Building…" : "Build"}<kbd>{keybindings.build}</kbd></button>
          <button className={`icon-button ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(true)} aria-label="Open editor settings" title="Editor settings (Ctrl+,)">
            <Settings2 size={16} />
          </button>
          <button className={`icon-button ai-toggle ${aiOpen ? "active" : ""}`} onClick={() => setAiOpen((value) => !value)} aria-label="Toggle AI panel">
            {aiOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>
      <WorkspaceTabs
        ariaLabel="Open projects"
        className="project-tabs"
        items={projectSessions.map((session) => ({
          id: session.project.root,
          label: session.project.name,
          accessibleLabel: `${session.project.name} (${session.project.root})`,
          title: session.project.root,
          dirty: session.project.root === project.root && dirty,
        }))}
        activeId={project.root}
        addLabel="Open project"
        onActivate={(root) => {
          const session = projectSessionsRef.current.find((candidate) => candidate.project.root === root);
          if (session) void activateProject(session.project);
        }}
        onClose={(root) => { void closeProjectTab(root); }}
        onAdd={() => { void openProject(); }}
      />

      <main className="workspace dock-workspace" style={workspaceStyle}>
        {renderDockZone("left", leftPanes)}
        {renderDockZone("center", centerPanes)}
        {renderDockZone("right", rightPanes)}
        {renderDockZone("bottom", bottomPanes)}

        {leftPanes.length > 0 && (
          <DockBoundary
            label="Resize left dock"
            orientation="vertical"
            value={workspaceLayout.sizes.left}
            minimum={DOCK_SIZE_LIMITS.left[0]}
            maximum={DOCK_SIZE_LIMITS.left[1]}
            axis="x"
            sign={1}
            className="left"
            onChange={(value) => setWorkspaceLayout((current) => resizeDock(current, "left", value))}
          />
        )}
        {rightPanes.length > 0 && (
          <DockBoundary
            label="Resize right dock"
            orientation="vertical"
            value={workspaceLayout.sizes.right}
            minimum={DOCK_SIZE_LIMITS.right[0]}
            maximum={DOCK_SIZE_LIMITS.right[1]}
            axis="x"
            sign={-1}
            className="right"
            onChange={(value) => setWorkspaceLayout((current) => resizeDock(current, "right", value))}
          />
        )}
        {bottomPanes.length > 0 && (
          <DockBoundary
            label="Resize bottom dock"
            orientation="horizontal"
            value={workspaceLayout.sizes.bottom}
            minimum={DOCK_SIZE_LIMITS.bottom[0]}
            maximum={DOCK_SIZE_LIMITS.bottom[1]}
            axis="y"
            sign={-1}
            className="bottom"
            onChange={(value) => setWorkspaceLayout((current) => resizeDock(current, "bottom", value))}
          />
        )}

        {draggingPane && (
          <div
            className="dock-drop-overlay"
            aria-label={`Choose a dock for ${draggingPane}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDraggingPane(undefined);
            }}
          >
            {DOCK_SLOTS.map((slot) => (
              <button
                type="button"
                key={slot}
                className={`dock-drop-target ${slot}`}
                data-dock-slot={slot}
                onClick={() => {
                  movePane(draggingPane, slot);
                  setDraggingPane(undefined);
                }}
              >
                {DOCK_SLOT_LABELS[slot]}
              </button>
            ))}
          </div>
        )}
      </main>

      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          font={font}
          fontSize={fontSize}
          mathToolbarEnabled={mathToolbarEnabled}
          mathToolbarPosition={mathToolbarPosition}
          customToolbarEnabled={customToolbarEnabled}
          customToolbarPosition={customToolbarPosition}
          customCommands={customCommands}
          buildMode={buildMode}
          spellcheckEnabled={spellcheckEnabled}
          spellcheckDialect={spellcheckDialect}
          keybindings={keybindings}
          onThemeChange={setTheme}
          onFontChange={setFont}
          onFontSizeChange={setFontSize}
          onMathToolbarEnabledChange={setMathToolbarEnabled}
          onMathToolbarPositionChange={setMathToolbarPosition}
          onCustomToolbarEnabledChange={setCustomToolbarEnabled}
          onCustomToolbarPositionChange={setCustomToolbarPosition}
          onCustomCommandChange={changeCustomCommand}
          onBuildModeChange={setBuildMode}
          onSpellcheckEnabledChange={setSpellcheckEnabled}
          onSpellcheckDialectChange={setSpellcheckDialect}
          onKeybindingChange={changeKeybinding}
          onReset={resetSettings}
          onClose={closeSettings}
        />
      )}

      {tableEditor && (
        <TableEditor
          initialTable={tableEditor.mode === "edit" ? tableEditor.initialTable : undefined}
          onClose={() => {
            setTableEditor(undefined);
            editorRef.current?.focus();
          }}
          onInsert={async (latex, requiredPackages) => {
            try {
              let addedPackages: string[] = [];
              const targetPath = tableEditor.mode === "edit" ? tableEditor.path : activePath;
              const targetSelection = tableEditor.mode === "edit" ? tableEditor.selection : undefined;
              if (targetPath !== activePath) throw new Error("The source document changed while the table editor was open.");
              if (targetPath === project.rootDocument) {
                addedPackages = editorRef.current?.insertTable(latex, requiredPackages, targetSelection) ?? [];
              } else {
                if (requiredPackages.length) {
                  const rootSource = await readFile(project.root, project.rootDocument);
                  const preambleInsertion = createLatexPreambleInsertion(rootSource, requiredPackages);
                  if (preambleInsertion) {
                    const updatedRoot = `${rootSource.slice(0, preambleInsertion.offset)}${preambleInsertion.text}${rootSource.slice(preambleInsertion.offset)}`;
                    await writeFile(project.root, project.rootDocument, updatedRoot);
                    addedPackages = preambleInsertion.addedPackages;
                  }
                }
                editorRef.current?.insertTable(latex, [], targetSelection);
              }
              setNotice(addedPackages.length
                ? `Table ${tableEditor.mode === "edit" ? "updated" : "inserted"}. Added ${addedPackages.join(", ")} to ${project.rootDocument}.`
                : `Table ${tableEditor.mode === "edit" ? "updated" : "inserted"}.`);
              setTableEditor(undefined);
            } catch (error) {
              setNotice(`Could not ${tableEditor.mode === "edit" ? "update" : "insert"} the table safely: ${String(error)}`);
            }
          }}
        />
      )}

      {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X size={13} /></button></div>}

      <footer className="statusbar">
        <span className={buildResult && !buildResult.success ? "status-error" : "status-ok"}>{buildResult && !buildResult.success ? <CircleAlert size={12} /> : <Check size={12} />}{status}</span>
        <span className={saveStatus === "error" ? "status-error" : ""}>
          {saveStatus === "saving" ? "Autosaving…" : saveStatus === "error" ? "Autosave failed" : dirty ? "Autosave pending" : "Autosaved"}
        </span>
        <span>{engine === "pdflatex" ? "pdfLaTeX" : engine === "xelatex" ? "XeLaTeX" : "LuaLaTeX"}</span>
        <span className="status-spacer" />
        <span>{activePath.endsWith(".bib") ? "BibTeX" : "LaTeX"}</span>
        <span>UTF-8</span>
        <span>Spaces: 2</span>
        <button
          className={spellcheckStatus.phase === "error" ? "status-error" : spellcheckStatus.issueCount ? "spellcheck-issues" : ""}
          onClick={() => setSettingsOpen(true)}
          title={spellcheckStatus.message ?? "Open writing assistance settings"}
        >
          <SpellCheck2 size={12} />
          {spellcheckStatus.phase === "disabled"
            ? "Writing check off"
            : spellcheckStatus.phase === "loading"
              ? "Loading Harper…"
              : spellcheckStatus.phase === "error"
                ? "Harper unavailable"
                : spellcheckStatus.issueCount
                  ? `${spellcheckStatus.issueCount} writing ${spellcheckStatus.issueCount === 1 ? "suggestion" : "suggestions"}`
                  : "Writing looks good"}
        </button>
        <button onClick={() => setAiOpen(true)}><Bot size={12} /> AI ready</button>
      </footer>
    </div>
  );
}

// Named exports keep the large workspace's independently stateful surfaces directly testable.
export {
  AiPanel,
  CustomToolbar,
  Diagnostics,
  EditorToolbar,
  FileRail,
  KeybindingRecorder,
  MathCommandMenu,
  MathToolbar,
  PdfStage,
  SettingsPanel,
  ToolbarButton,
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
};
