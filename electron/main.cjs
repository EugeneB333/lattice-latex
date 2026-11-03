const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");

const projectRoot = path.resolve(__dirname, "..");
const preferredDevPort = Number.parseInt(process.env.LATTICE_DEV_PORT || "1420", 10);
let devUrl = "http://127.0.0.1:1420";
const allowedCommands = new Set([
  "detect_engines",
  "read_project",
  "read_project_file",
  "write_project_file",
  "compile_project",
  "render_pdf_page",
  "forward_search",
  "inverse_search",
  "propose_ai_edit",
]);

let mainWindow;
let backendProcess;
let devServerProcess;
let nextRequestId = 1;
const pendingRequests = new Map();
const printWindows = new Set();
const pickerProcesses = new Set();
let recentProjects = [];

const MAX_PICKER_OUTPUT_CHARS = 16 * 1024;

app.setName("Lattice");

function backendBinaryPath() {
  if (process.env.LATTICE_BACKEND_PATH) return process.env.LATTICE_BACKEND_PATH;
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend", process.platform === "win32" ? "lattice-backend.exe" : "lattice-backend");
  }
  const targetDirectory = process.env.CARGO_TARGET_DIR || "/dev/shm/lattice-backend-target";
  return path.join(targetDirectory, "debug", process.platform === "win32" ? "lattice-backend.exe" : "lattice-backend");
}

function rejectPending(message) {
  for (const { reject } of pendingRequests.values()) reject(new Error(message));
  pendingRequests.clear();
}

function startBackend() {
  const binary = backendBinaryPath();
  if (!fs.existsSync(binary)) {
    throw new Error(`Rust backend not found at ${binary}. Run npm run backend:build first.`);
  }
  backendProcess = spawn(binary, [], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  readline.createInterface({ input: backendProcess.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.error("Lattice backend returned malformed JSON");
      return;
    }
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  });
  backendProcess.stderr.on("data", (chunk) => process.stderr.write(`[lattice-backend] ${chunk}`));
  backendProcess.on("error", (error) => {
    console.error("Could not start the Rust backend:", error);
    rejectPending(error.message);
  });
  backendProcess.on("exit", (code, signal) => {
    rejectPending(`Rust backend stopped (${signal || code || "unknown reason"})`);
    backendProcess = undefined;
  });
}

function invokeBackend(command, args = {}) {
  if (!backendProcess?.stdin?.writable) return Promise.reject(new Error("Rust backend is unavailable"));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    backendProcess.stdin.write(`${JSON.stringify({ id, command, args })}\n`, (error) => {
      if (!error) return;
      pendingRequests.delete(id);
      reject(error);
    });
  });
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function findExecutableOnPath(executable) {
  const directories = (process.env.PATH || "").split(path.delimiter);
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, executable);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

function runZenityDirectoryPicker(executable) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let picker;
    try {
      picker = spawn(executable, [
        "--file-selection",
        "--directory",
        "--modal",
        "--title=Open a LaTeX project",
        "--ok-label=Open",
      ], {
        env: { ...process.env, GTK_USE_PORTAL: "0" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ status: "failed", detail: String(error) });
      return;
    }
    pickerProcesses.add(picker);
    const collect = (current, chunk) => {
      const next = current + String(chunk);
      if (next.length <= MAX_PICKER_OUTPUT_CHARS) return next;
      outputTooLarge = true;
      if (!picker.killed) picker.kill("SIGTERM");
      return next.slice(0, MAX_PICKER_OUTPUT_CHARS);
    };
    picker.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    picker.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    picker.once("error", (error) => {
      pickerProcesses.delete(picker);
      finish({ status: "failed", detail: String(error) });
    });
    picker.once("close", (code, signal) => {
      pickerProcesses.delete(picker);
      if (outputTooLarge) {
        finish({ status: "failed", detail: "zenity returned too much output" });
        return;
      }
      if (code === 1 || signal) {
        finish({ status: "cancelled" });
        return;
      }
      if (code !== 0) {
        finish({ status: "failed", detail: stderr.trim() || `zenity exited with status ${code}` });
        return;
      }
      const selectedPath = stdout.replace(/[\r\n]+$/, "");
      if (!selectedPath || !path.isAbsolute(selectedPath)) {
        finish({ status: "failed", detail: "zenity returned an invalid project path" });
        return;
      }
      finish({ status: "selected", path: selectedPath });
    });
  });
}

async function chooseProjectDirectory() {
  if (process.platform === "linux") {
    const zenity = findExecutableOnPath("zenity");
    if (zenity) {
      const result = await runZenityDirectoryPicker(zenity);
      if (result.status === "selected") return result.path;
      if (result.status === "cancelled") return null;
      console.warn(`Lattice: fast Linux project picker failed; using Electron fallback (${result.detail})`);
    }
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open a LaTeX project",
    properties: ["openDirectory"],
  });
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

function resolveBuiltPdf(root, rootDocument) {
  if (typeof root !== "string" || typeof rootDocument !== "string" || path.isAbsolute(rootDocument)) {
    throw new Error("Invalid project path");
  }
  const rootPath = fs.realpathSync(root);
  const sourcePath = path.resolve(rootPath, rootDocument);
  if (!pathIsWithin(rootPath, sourcePath)) throw new Error("The root document is outside the project");
  const buildRoot = path.join(rootPath, ".lattice", "build");
  const pdfPath = fs.realpathSync(path.join(buildRoot, `${path.parse(rootDocument).name}.pdf`));
  if (!pathIsWithin(buildRoot, pdfPath)) throw new Error("The rendered PDF is outside the project build folder");
  return pdfPath;
}

async function printPdf(pdfPath) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  printWindows.add(printWindow);
  printWindow.on("closed", () => printWindows.delete(printWindow));
  try {
    await printWindow.loadFile(pdfPath);
    await new Promise((resolve, reject) => {
      printWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) resolve();
        else reject(new Error(reason || "Printing was cancelled"));
      });
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
  }
}

function sendMenuAction(action, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("lattice:menu-action", action, payload);
}

function installApplicationMenu() {
  const recentSubmenu = recentProjects.length
    ? recentProjects.map((project) => ({
      label: project.name,
      sublabel: project.root,
      click: () => sendMenuAction("open-recent", project.root),
    }))
    : [{ label: "No Recent Projects", enabled: false }];
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("open-project") },
        { label: "Open Recent", submenu: recentSubmenu },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuAction("save-as") },
        { type: "separator" },
        { label: "Print Rendered PDF…", accelerator: "CmdOrCtrl+P", click: () => sendMenuAction("print-pdf") },
        { label: "Open Rendered PDF Externally", click: () => sendMenuAction("open-pdf") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(!app.isPackaged ? [{ role: "toggleDevTools" }, { type: "separator" }] : []),
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(null);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else resolve(selectedPort);
      });
    });
  });
}

async function findAvailableDevPort() {
  const preferred = Number.isInteger(preferredDevPort) && preferredDevPort > 0 && preferredDevPort < 65536
    ? preferredDevPort
    : 1420;
  return (await probePort(preferred)) ?? await probePort(0);
}

async function startDevServer() {
  const port = await findAvailableDevPort();
  if (!port) throw new Error("Could not allocate a local port for the Lattice development server");
  devUrl = `http://127.0.0.1:${port}`;
  console.log(`Lattice development server: ${devUrl}`);

  let startError;
  let serverReady = false;
  devServerProcess = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  devServerProcess.once("error", (error) => { startError = error; });
  devServerProcess.once("exit", (code, signal) => {
    if (!serverReady) startError = new Error(`The Lattice development server stopped (${signal || code || "unknown reason"})`);
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (startError) throw startError;
    try {
      const response = await fetch(devUrl);
      if (response.ok) {
        serverReady = true;
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The Lattice development server did not start in time");
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Lattice",
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#11120f",
    icon: path.join(projectRoot, "assets", "app-icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installApplicationMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? url.startsWith("file:") : url.startsWith(devUrl);
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Lattice renderer stopped:", details);
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (app.isPackaged) await mainWindow.loadFile(path.join(projectRoot, "dist", "index.html"));
  else await mainWindow.loadURL(devUrl);
}

ipcMain.handle("lattice:invoke", async (_event, command, args) => {
  if (command === "read_starter_project") {
    const root = path.join(app.getPath("userData"), "reliable-documents");
    return invokeBackend("ensure_starter_project", { root });
  }
  if (command === "choose_project") {
    const selectedPath = await chooseProjectDirectory();
    if (!selectedPath) return null;
    return invokeBackend("read_project", { root: selectedPath });
  }
  if (command === "set_recent_projects") {
    recentProjects = Array.isArray(args?.recent)
      ? args.recent
        .filter((item) => item && typeof item.root === "string" && typeof item.name === "string")
        .slice(0, 10)
        .map((item) => ({ root: item.root.slice(0, 4096), name: item.name.slice(0, 160) }))
      : [];
    installApplicationMenu();
    return null;
  }
  if (command === "save_project_file_as") {
    const { root, path: sourcePath, rootDocument, content } = args || {};
    if (![root, sourcePath, rootDocument, content].every((value) => typeof value === "string")) {
      throw new Error("Invalid Save As request");
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save LaTeX file as",
      defaultPath: path.join(root, sourcePath),
      filters: [
        { name: "LaTeX source", extensions: ["tex", "sty", "cls"] },
        { name: "BibTeX bibliography", extensions: ["bib"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    const sourceExtension = path.extname(sourcePath) || ".tex";
    const selectedPath = path.extname(result.filePath) ? result.filePath : `${result.filePath}${sourceExtension}`;
    if (selectedPath !== result.filePath && fs.existsSync(selectedPath)) {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Replace existing file?",
        message: `${path.basename(selectedPath)} already exists.`,
        detail: "Saving will replace its current contents.",
        buttons: ["Cancel", "Replace"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) return null;
    }
    const originalRoot = fs.realpathSync(root);
    const targetParent = fs.realpathSync(path.dirname(selectedPath));
    const targetAbsolute = path.join(targetParent, path.basename(selectedPath));
    const insideOriginalProject = pathIsWithin(originalRoot, targetAbsolute);
    const targetRoot = insideOriginalProject ? originalRoot : targetParent;
    const targetPath = insideOriginalProject
      ? path.relative(originalRoot, targetAbsolute)
      : path.basename(targetAbsolute);
    await invokeBackend("write_project_file", { root: targetRoot, path: targetPath, content });
    const project = await invokeBackend("read_project", { root: targetRoot });
    if (!insideOriginalProject || sourcePath === rootDocument) project.rootDocument = targetPath;
    return { project, path: targetPath };
  }
  if (command === "open_built_pdf") {
    const pdfPath = resolveBuiltPdf(args?.root, args?.rootDocument);
    const error = await shell.openPath(pdfPath);
    if (error) throw new Error(error);
    return null;
  }
  if (command === "print_built_pdf") {
    await printPdf(resolveBuiltPdf(args?.root, args?.rootDocument));
    return null;
  }
  if (!allowedCommands.has(command)) throw new Error(`Unsupported desktop command: ${command}`);
  return invokeBackend(command, args);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      startBackend();
      await invokeBackend("detect_engines");
      if (!app.isPackaged) await startDevServer();
      await createWindow();
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      console.error("Lattice could not start:", message);
      dialog.showErrorBox("Lattice could not start", message);
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const picker of pickerProcesses) {
    if (!picker.killed) picker.kill("SIGTERM");
  }
  pickerProcesses.clear();
  if (devServerProcess && !devServerProcess.killed) devServerProcess.kill("SIGTERM");
  if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGTERM");
});
