// Starts the Next.js standalone server on a free 127.0.0.1 port, then shows it
// in a window. Quitting the app stops the server.
const { app, BrowserWindow, Menu, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const SMOKE = process.env.ICONMASCHINE_SMOKE === "1";
let win = null;
let server = null;
let origin = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(main);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => req.destroy());
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!server) return false;
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function serverDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next", "standalone");
}

function logFile() {
  const dir = app.getPath("logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "server.log");
}

async function startServer(log) {
  const port = await freePort();
  const dir = serverDir();
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) throw new Error(`The server is missing: ${entry}`);
  const out = fs.createWriteStream(log, { flags: "a" });
  out.write(`\n--- ${new Date().toISOString()} start on port ${port}\n`);
  server = utilityProcess.fork(entry, [], {
    cwd: dir,
    stdio: "pipe",
    serviceName: "iconmaschine server",
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  server.stdout?.pipe(out);
  server.stderr?.pipe(out);
  server.on("exit", (code) => {
    server = null;
    if (!quitting) showError(`The server stopped (exit code ${code}).`, log);
  });
  origin = `http://127.0.0.1:${port}`;
  return waitFor(`${origin}/api/status`, 30000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function showError(message, log) {
  if (SMOKE) {
    console.error(`smoke: ${message} Log: ${log}`);
    app.exit(1);
    return;
  }
  if (!win) createWindow();
  const html = `<!doctype html><meta charset="utf-8"><title>iconmaschine</title>
<body style="font:14px -apple-system,sans-serif;background:#141414;color:#eee;padding:40px">
<h2>iconmaschine could not start</h2><p>${escapeHtml(message)}</p>
<p>The server log is at <code>${escapeHtml(log)}</code>.</p></body>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function isLocal(url) {
  return origin !== null && (url === origin || url.startsWith(origin + "/"));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 380,
    title: "iconmaschine",
    backgroundColor: "#141414",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

async function smokeCheck() {
  for (const p of ["/", "/api/status", "/api/packs", "/api/settings"]) {
    const ok = await ping(origin + p);
    console.log(`smoke: ${p} ${ok ? "ok" : "FAILED"}`);
    if (!ok) return app.exit(1);
  }
  quitting = true;
  server?.kill();
  app.exit(0);
}

async function main() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  const log = logFile();
  let ready;
  try {
    ready = await startServer(log);
  } catch (e) {
    return showError(e.message, log);
  }
  if (!ready) {
    if (server) showError("The server did not answer within 30 seconds.", log);
    return;
  }
  if (SMOKE) return smokeCheck();
  if (!win) createWindow();
  win.loadURL(origin + "/");
}

app.on("before-quit", () => {
  quitting = true;
  server?.kill();
});

// The server runs only while the window is open.
app.on("window-all-closed", () => app.quit());
