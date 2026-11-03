const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electronBinary = require("electron");
const projectRoot = path.resolve(__dirname, "..");
const electronArguments = [];

if (process.platform === "linux") {
  const sandboxHelper = path.join(path.dirname(electronBinary), "chrome-sandbox");
  let hasWorkingSetuidSandbox = false;

  try {
    const metadata = fs.statSync(sandboxHelper);
    hasWorkingSetuidSandbox = metadata.uid === 0 && (metadata.mode & 0o4000) !== 0;
  } catch {
    // A source checkout can still run locally without the optional helper.
  }

  if (!hasWorkingSetuidSandbox) {
    console.warn(
      "Lattice: Chromium's Linux sandbox helper is not configured; " +
        "using the development-only --no-sandbox fallback.",
    );
    electronArguments.push("--no-sandbox");
  }
}

electronArguments.push(projectRoot);

const child = spawn(electronBinary, electronArguments, {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Could not launch Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
