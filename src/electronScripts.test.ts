import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const nativeRequire = createRequire(import.meta.url);
const projectRoot = path.resolve(process.cwd());

afterEach(() => vi.restoreAllMocks());

function evaluate(file: string, requireModule: (id: string) => unknown, processValue: NodeJS.Process | Record<string, unknown> = process) {
  const filename = path.join(projectRoot, file);
  const source = fs.readFileSync(filename, "utf8");
  const context = vm.createContext({
    require: requireModule,
    module: { exports: {} },
    exports: {},
    __filename: filename,
    __dirname: path.dirname(filename),
    process: processValue,
    console,
    setTimeout,
    clearTimeout,
    fetch: vi.fn(),
  });
  vm.runInContext(source, context, { filename });
  return context;
}

describe("Electron preload bridge", () => {
  it("exposes the exact invoke channel and forwards command arguments", async () => {
    let api: Record<string, Function> = {};
    const invoke = vi.fn().mockResolvedValue("ok");
    evaluate("electron/preload.cjs", (id) => {
      if (id !== "electron") return nativeRequire(id);
      return { contextBridge: { exposeInMainWorld: (_name: string, value: Record<string, Function>) => { api = value; } }, ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() } };
    });
    await expect(api.invoke("read_project", { root: "/paper" })).resolves.toBe("ok");
    expect(invoke).toHaveBeenCalledWith("lattice:invoke", "read_project", { root: "/paper" });
  });

  it("forwards menu actions without the Electron event and removes the same listener", () => {
    let api: Record<string, Function> = {};
    let listener: Function | undefined;
    const on = vi.fn((_channel, next) => { listener = next; });
    const removeListener = vi.fn();
    evaluate("electron/preload.cjs", (id) => {
      if (id !== "electron") return nativeRequire(id);
      return { contextBridge: { exposeInMainWorld: (_name: string, value: Record<string, Function>) => { api = value; } }, ipcRenderer: { invoke: vi.fn(), on, removeListener } };
    });
    const callback = vi.fn();
    const dispose = api.onMenuAction(callback);
    listener?.({ sender: "ignored" }, "open-recent", "/paper");
    expect(callback).toHaveBeenCalledWith("open-recent", "/paper");
    dispose();
    expect(removeListener).toHaveBeenCalledWith("lattice:menu-action", listener);
  });
});

describe("Electron launch policy", () => {
  function runLaunch(platform: string, metadata?: { uid: number; mode: number }, statThrows = false) {
    const spawn = vi.fn((..._args: unknown[]) => ({ killed: false, kill: vi.fn(), on: vi.fn() }));
    const on = vi.fn();
    const processValue = { platform, env: {}, on, kill: vi.fn(), pid: 4, exitCode: 0 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    evaluate("electron/launch.cjs", (id) => {
      if (id === "electron") return "/opt/electron/electron";
      if (id === "node:child_process") return { spawn };
      if (id === "node:fs") return { statSync: () => { if (statThrows) throw new Error("missing"); return metadata; } };
      return nativeRequire(id);
    }, processValue);
    return { spawn, on, warn, processValue };
  }

  afterEach(() => vi.restoreAllMocks());

  it("uses Chromium's configured root-owned setuid sandbox", () => {
    const { spawn, warn } = runLaunch("linux", { uid: 0, mode: 0o104755 });
    expect(spawn.mock.calls[0]![1]).toEqual([projectRoot]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [{ uid: 1000, mode: 0o104755 }, false],
    [{ uid: 0, mode: 0o100755 }, false],
    [undefined, true],
  ])("uses the development fallback when the Linux helper is unusable", (metadata, throws) => {
    const { spawn, warn } = runLaunch("linux", metadata, throws);
    expect(spawn.mock.calls[0]![1]).toEqual(["--no-sandbox", projectRoot]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never adds the Linux fallback on other platforms", () => {
    const { spawn } = runLaunch("win32");
    expect(spawn.mock.calls[0]![1]).toEqual([projectRoot]);
  });

  it("forwards termination signals and propagates child failures and exits", () => {
    const childHandlers = new Map<string, Function>();
    const child = { killed: false, kill: vi.fn(), on: vi.fn((event: string, handler: Function) => childHandlers.set(event, handler)) };
    const spawn = vi.fn((..._args: unknown[]) => child);
    const processHandlers = new Map<string, Function>();
    const processValue = { platform: "win32", env: {}, on: vi.fn((event: string, handler: Function) => processHandlers.set(event, handler)), kill: vi.fn(), pid: 8, exitCode: 0 };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    evaluate("electron/launch.cjs", (id) => id === "electron" ? "electron.exe" : id === "node:child_process" ? { spawn } : nativeRequire(id), processValue);
    processHandlers.get("SIGTERM")?.();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    childHandlers.get("error")?.(new Error("boom"));
    expect(error).toHaveBeenCalledWith("Could not launch Electron: boom");
    expect(processValue.exitCode).toBe(1);
    childHandlers.get("exit")?.(3, null);
    expect(processValue.exitCode).toBe(3);
    childHandlers.get("exit")?.(null, "SIGINT");
    expect(processValue.kill).toHaveBeenCalledWith(8, "SIGINT");
  });
});

describe("Electron main-process command boundary", () => {
  function loadMain(options: {
    saveResult?: unknown;
    openResult?: unknown;
    openPathError?: string;
    printSuccess?: boolean;
    platform?: string;
    executablePath?: string;
    zenityResult?: { code?: number; stdout?: string; stderr?: string; error?: Error };
  } = {}) {
    let handler: ((event: unknown, command: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined;
    const menuTemplates: unknown[] = [];
    const openPath = vi.fn().mockResolvedValue(options.openPathError ?? "");
    const showOpenDialog = vi.fn().mockResolvedValue(options.openResult ?? { canceled: true, filePaths: [] });
    const showSaveDialog = vi.fn().mockResolvedValue(options.saveResult ?? { canceled: true });
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        if (options.zenityResult?.error) {
          child.emit("error", options.zenityResult.error);
          return;
        }
        child.stdout.end(options.zenityResult?.stdout ?? "");
        child.stderr.end(options.zenityResult?.stderr ?? "");
        child.emit("close", options.zenityResult?.code ?? 0, null);
      });
      return child;
    });
    const print = vi.fn((_options, callback) => callback(options.printSuccess ?? true, options.printSuccess === false ? "printer failed" : ""));
    class BrowserWindow {
      webContents = { print };
      isDestroyed = () => false;
      close = vi.fn();
      loadFile = vi.fn().mockResolvedValue(undefined);
      on = vi.fn();
    }
    const electron = {
      app: {
        setName: vi.fn(), requestSingleInstanceLock: vi.fn(() => false), quit: vi.fn(), on: vi.fn(),
        getPath: vi.fn(() => "/app-data"), isPackaged: false,
      },
      BrowserWindow,
      dialog: { showOpenDialog, showSaveDialog, showMessageBox: vi.fn(), showErrorBox: vi.fn() },
      ipcMain: { handle: vi.fn((_channel, next) => { handler = next; }) },
      Menu: { buildFromTemplate: vi.fn((template) => { menuTemplates.push(template); return template; }), setApplicationMenu: vi.fn() },
      shell: { openPath, openExternal: vi.fn() },
    };
    const processValue = {
      platform: options.platform ?? "linux",
      env: { ...process.env, PATH: options.executablePath ?? "" },
    };
    const context = evaluate("electron/main.cjs", (id) => {
      if (id === "electron") return electron;
      if (id === "node:child_process") return { spawn };
      return nativeRequire(id);
    }, processValue);
    return { handler: handler!, electron, menuTemplates, openPath, showOpenDialog, showSaveDialog, print, spawn, context };
  }

  function executableDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-picker-"));
    const executable = path.join(directory, "zenity");
    fs.writeFileSync(executable, "");
    fs.chmodSync(executable, 0o755);
    return directory;
  }

  it("rejects unsupported renderer commands", async () => {
    const { handler } = loadMain();
    await expect(handler({}, "run_shell", {})).rejects.toThrow("Unsupported desktop command");
  });

  it("allows the renderer to request a bounded native PDF page render", async () => {
    const { handler } = loadMain();
    await expect(handler({}, "render_pdf_page", { root: "/paper", rootDocument: "main.tex", pdfVersion: "v1", page: 1 }))
      .rejects.toThrow("Rust backend is unavailable");
  });

  it("returns null when project and Save As dialogs are cancelled", async () => {
    const { handler } = loadMain();
    await expect(handler({}, "choose_project", {})).resolves.toBeNull();
    await expect(handler({}, "save_project_file_as", { root: "/paper", path: "main.tex", rootDocument: "main.tex", content: "text" })).resolves.toBeNull();
  });

  it("uses a direct GTK zenity directory picker on Linux", async () => {
    const directory = executableDirectory();
    const { context, showOpenDialog, spawn } = loadMain({
      executablePath: directory,
      zenityResult: { code: 0, stdout: "/documents/paper\n" },
    });
    await expect(context.chooseProjectDirectory()).resolves.toBe("/documents/paper");
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      path.join(directory, "zenity"),
      ["--file-selection", "--directory", "--modal", "--title=Open a LaTeX project", "--ok-label=Open"],
      expect.objectContaining({ shell: false, env: expect.objectContaining({ GTK_USE_PORTAL: "0" }) }),
    );
    fs.rmSync(directory, { recursive: true });
  });

  it("treats zenity cancellation as cancellation without opening a second dialog", async () => {
    const directory = executableDirectory();
    const { context, showOpenDialog } = loadMain({ executablePath: directory, zenityResult: { code: 1 } });
    await expect(context.chooseProjectDirectory()).resolves.toBeNull();
    expect(showOpenDialog).not.toHaveBeenCalled();
    fs.rmSync(directory, { recursive: true });
  });

  it.each([
    ["a picker error", { code: 2, stderr: "picker failed" }],
    ["an invalid relative result", { code: 0, stdout: "relative/project\n" }],
    ["a spawn failure", { error: new Error("spawn failed") }],
  ])("falls back to Electron after %s", async (_label, zenityResult) => {
    const directory = executableDirectory();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { context, showOpenDialog } = loadMain({
      executablePath: directory,
      zenityResult,
      openResult: { canceled: false, filePaths: ["/native/project"] },
    });
    await expect(context.chooseProjectDirectory()).resolves.toBe("/native/project");
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("using Electron fallback"));
    fs.rmSync(directory, { recursive: true });
  });

  it("bounds picker output before falling back", async () => {
    const directory = executableDirectory();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { context, showOpenDialog, spawn } = loadMain({
      executablePath: directory,
      zenityResult: { code: 0, stdout: `/${"x".repeat(20_000)}` },
      openResult: { canceled: false, filePaths: ["/native/project"] },
    });
    await expect(context.chooseProjectDirectory()).resolves.toBe("/native/project");
    expect(spawn.mock.results[0].value.kill).toHaveBeenCalledWith("SIGTERM");
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("too much output"));
    fs.rmSync(directory, { recursive: true });
  });

  it.each([
    ["Linux without zenity", "linux", ""],
    ["other platforms", "darwin", "/usr/bin"],
  ])("uses Electron's native picker on %s", async (_label, platform, executablePath) => {
    const { context, showOpenDialog, spawn } = loadMain({
      platform,
      executablePath,
      openResult: { canceled: false, filePaths: ["/native/project"] },
    });
    await expect(context.chooseProjectDirectory()).resolves.toBe("/native/project");
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("validates Save As input before opening a dialog", async () => {
    const { handler, showSaveDialog } = loadMain();
    await expect(handler({}, "save_project_file_as", { root: "/paper", path: 2 })).rejects.toThrow("Invalid Save As request");
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it("sanitizes, truncates, and limits recent projects before rebuilding the menu", async () => {
    const { handler, menuTemplates } = loadMain();
    const recent = [null, { root: 2, name: "bad" }, ...Array.from({ length: 12 }, (_, index) => ({ root: `/${"r".repeat(5000)}${index}`, name: `Name ${"n".repeat(200)}${index}` }))];
    await expect(handler({}, "set_recent_projects", { recent })).resolves.toBeNull();
    const template = menuTemplates.at(-1) as Array<{ label: string; submenu: Array<{ label: string; submenu?: Array<{ label: string; sublabel: string }> }> }>;
    const items = template[0].submenu.find((item) => item.label === "Open Recent")!.submenu!;
    expect(items).toHaveLength(10);
    expect(items[0].label.length).toBe(160);
    expect(items[0].sublabel.length).toBe(4096);
  });

  it("opens only a canonical built PDF inside the build folder", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-electron-"));
    fs.mkdirSync(path.join(root, ".lattice", "build"), { recursive: true });
    const pdf = path.join(root, ".lattice", "build", "main.pdf");
    fs.writeFileSync(pdf, "pdf");
    const { handler, openPath } = loadMain();
    await expect(handler({}, "open_built_pdf", { root, rootDocument: "main.tex" })).resolves.toBeNull();
    expect(openPath).toHaveBeenCalledWith(fs.realpathSync(pdf));
    await expect(handler({}, "open_built_pdf", { root, rootDocument: "/etc/passwd" })).rejects.toThrow("Invalid project path");
    fs.rmSync(root, { recursive: true });
  });

  it("surfaces shell and print errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-electron-"));
    fs.mkdirSync(path.join(root, ".lattice", "build"), { recursive: true });
    fs.writeFileSync(path.join(root, ".lattice", "build", "main.pdf"), "pdf");
    const open = loadMain({ openPathError: "no viewer" });
    await expect(open.handler({}, "open_built_pdf", { root, rootDocument: "main.tex" })).rejects.toThrow("no viewer");
    const print = loadMain({ printSuccess: false });
    await expect(print.handler({}, "print_built_pdf", { root, rootDocument: "main.tex" })).rejects.toThrow("printer failed");
    fs.rmSync(root, { recursive: true });
  });
});
