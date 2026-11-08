// Drives the packaged app through its window (Chrome DevTools Protocol) and
// its own server, started the way Finder starts it: no shell env, no keys.
// Uses temp folders for app data and NI Resources. Needs Maschine 3 on this
// Mac, and sends one search with a fake SerpAPI key.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const repo = process.cwd();
const appBin = path.join(repo, "dist/mac-arm64/iconmaschine.app/Contents/MacOS/iconmaschine");
const sharp = createRequire(path.join(repo, "package.json"))("sharp");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-drive-"));
const home = path.join(tmp, "home");
const ni = path.join(tmp, "NI Resources");
fs.mkdirSync(path.join(ni, "image"), { recursive: true });
fs.mkdirSync(path.join(ni, "dist_database"), { recursive: true });

const env = {
  HOME: os.homedir(),
  USER: os.userInfo().username,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  ICONMASCHINE_HOME: home,
  NI_RESOURCES_IMAGE_DIR: path.join(ni, "image"),
  NI_RESOURCES_DIST_DB_DIR: path.join(ni, "dist_database"),
};

async function launch(port) {
  const t0 = Date.now();
  const child = spawn(appBin, [`--remote-debugging-port=${port}`], { env, stdio: "ignore", detached: true });
  child.unref();
  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1"));
      if (page) return { page, ms: Date.now() - t0 };
    } catch {}
    await sleep(100);
  }
  throw new Error("no page target");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)(msg);
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const eval_ = async (expression) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    const msg = await new Promise((r) => waiting.set(n, r));
    return msg.result?.result?.value;
  };
  return { eval: eval_, close: () => ws.close() };
}

const listeners = () => {
  try {
    return execSync("lsof -iTCP -sTCP:LISTEN -P -n | grep '^iconmasch' || true").toString().trim();
  } catch {
    return "";
  }
};

const { page, ms } = await launch(9333);
const origin = new URL(page.url).origin;
check("window shows the app within 5 s", ms < 5000, `${(ms / 1000).toFixed(1)} s`);
const ls = listeners();
check("server listens on 127.0.0.1 only", ls && ls.split("\n").every((l) => l.includes("127.0.0.1:")), ls.replace(/\s+/g, " "));

const win = cdp(page.webSocketDebuggerUrl);
for (let i = 0; i < 50 && !(await win.eval("document.body?.innerText.includes('Kit type')")); i++) await sleep(200);
check("step layout rendered", await win.eval("document.body.innerText.includes('Kit type') && document.body.innerText.includes('Settings')"));

const status0 = await (await fetch(`${origin}/api/status`)).json();
check("no key without a shell env", status0.hasSerpKey === false && status0.hasOpenAiKey === false);

await win.eval(`[...document.querySelectorAll('button.drawer-item')].find(b => b.innerText.trim() === 'Settings').click()`);
await sleep(500);
check("Settings page opens from the drawer", await win.eval(`[...document.querySelectorAll('section.step h2')].some(h => h.innerText === 'Settings' && !h.closest('[hidden]'))`));

const saved = await (await fetch(`${origin}/api/settings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ SERPAPI_API_KEY: "serp-test-key-1234" }),
})).json();
check("saved key shows only its last 4", saved.settings.SERPAPI_API_KEY.hint === "1234" && !JSON.stringify(saved).includes("serp-test"));
const mode = (fs.statSync(path.join(home, "settings.json")).mode & 0o777).toString(8);
check("settings.json is mode 600", mode === "600", mode);
const status1 = await (await fetch(`${origin}/api/status`)).json();
check("new key works with no restart", status1.hasSerpKey === true);
const search = await (await fetch(`${origin}/api/image-search?q=serum%20logo`)).json();
check("search sends the saved key (SerpAPI rejects the fake one)", !/No SerpAPI key/.test(search.error ?? "") && Boolean(search.error), String(search.error).slice(0, 90));

const png = await sharp({ create: { width: 800, height: 400, channels: 4, background: "#f28c18" } }).png().toBuffer();
const form = new FormData();
form.set("kitType", "sample_kit");
form.set("product", "zz-app-test");
form.set("artwork", new Blob([png], { type: "image/png" }), "art.png");
const created = await (await fetch(`${origin}/api/packs`, { method: "POST", body: form })).json();
check("pack saves (sharp in the app)", Boolean(created.pack?.id), created.error ?? "");
const id = created.pack?.id;

const preview = await fetch(`${origin}/api/packs/${id}/preview`);
check("preview renders", preview.ok, String(preview.status));

const plan = await (await fetch(`${origin}/api/packs/${id}/install`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ dryRun: false, backup: false }),
})).json();
const written = fs.existsSync(path.join(ni, "image", "zz-app-test")) ? fs.readdirSync(path.join(ni, "image", "zz-app-test")) : [];
check("install writes the images", written.length >= 6, written.join(", "));

const exp = await fetch(`${origin}/api/packs/${id}/export`);
check("zip export is a download", exp.ok && /attachment/.test(exp.headers.get("content-disposition") ?? ""), exp.headers.get("content-disposition") ?? "");

const st = await fetch(`${origin}/api/packs/${id}/sample-tags`);
check("sample tags step answers (Maschine DB via node:sqlite)", st.ok, String(st.status));
const vocab = await (await fetch(`${origin}/api/tagvocab`)).json();
check("tag vocabulary reads Maschine DB", Array.isArray(vocab.types) && vocab.types.length > 0, `${vocab.types?.length} types`);

const cal = await fetch(`${origin}/api/calibrate`, { method: "POST" });
check("calibrate runs", cal.ok, String(cal.status));
const presets = await fetch(`${origin}/api/presets`);
check("preset tags list answers", presets.ok, String(presets.status));

const opened = await win.eval("window.open('https://example.com/') === null");
await sleep(500);
const targets = (await (await fetch("http://127.0.0.1:9333/json")).json()).filter((t) => t.type === "page");
check("external window.open is refused in the app", opened && targets.length === 1, `${targets.length} page(s)`);

spawn(appBin, [], { env, stdio: "ignore", detached: true }).unref();
await sleep(3000);
const ls2 = listeners().split("\n").filter((l) => l && !l.includes(":9333"));
check("second open starts no second server", ls2.length === 1, `${ls2.length} listener(s)`);

win.close();
execSync(`osascript -e 'quit app "iconmaschine"'`);
await sleep(2500);
check("quit leaves no server", listeners() === "");

const broken = path.join(tmp, "broken.app");
execSync(`ditto "${path.join(repo, "dist/mac-arm64/iconmaschine.app")}" "${broken}"`);
fs.rmSync(path.join(broken, "Contents/Resources/server/server.js"));
const child = spawn(path.join(broken, "Contents/MacOS/iconmaschine"), ["--remote-debugging-port=9334"], { env, stdio: "ignore", detached: true });
child.unref();
let errText = "";
for (let i = 0; i < 50 && !errText; i++) {
  await sleep(200);
  try {
    const t = (await (await fetch("http://127.0.0.1:9334/json")).json()).find((x) => x.type === "page");
    if (t) {
      const c = cdp(t.webSocketDebuggerUrl);
      errText = (await c.eval("document.body?.innerText ?? ''")) ?? "";
      c.close();
    }
  } catch {}
}
check("broken app shows the error and the log path", /could not start/.test(errText) && /server\.log/.test(errText), errText.replace(/\s+/g, " ").slice(0, 120));
execSync(`osascript -e 'quit app "iconmaschine"'`);
await sleep(1500);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
