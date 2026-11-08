// Runs after `next build` with ICONMASCHINE_STANDALONE=1. Completes the
// standalone folder, makes the app icon, and refuses a build that would ship
// keys or miss sharp's native parts.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sa = path.join(root, ".next", "standalone");
const fail = (msg) => {
  console.error(`prepare-app: ${msg}`);
  process.exit(1);
};

if (!fs.existsSync(path.join(sa, "server.js"))) {
  fail(".next/standalone/server.js is missing. Did next build run with ICONMASCHINE_STANDALONE=1?");
}

// The standalone server serves these only from inside its own folder.
fs.cpSync(path.join(root, ".next", "static"), path.join(sa, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(sa, "public"), { recursive: true });
}

// A dynamic path in presets.ts makes the tracer copy the whole project in.
// The server needs only server.js, package.json, .next and node_modules.
const keep = new Set(["server.js", "package.json", ".next", "node_modules", "public"]);
for (const name of fs.readdirSync(sa)) {
  if (!keep.has(name)) fs.rmSync(path.join(sa, name), { recursive: true, force: true });
}

const banned = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p);
    } else if (/^\.env/.test(e.name) && e.name !== ".env.example" || e.name === "settings.json") {
      banned.push(path.relative(root, p));
    }
  }
};
walk(sa);
for (const dir of ["docs", "src", "tests", "scripts", "electron"]) {
  if (fs.existsSync(path.join(sa, dir))) banned.push(`.next/standalone/${dir}/`);
}
if (banned.length) fail(`refusing to package keys or local data: ${banned.join(", ")}`);

for (const pkg of ["@img/sharp-darwin-arm64", "@img/sharp-libvips-darwin-arm64"]) {
  if (!fs.existsSync(path.join(sa, "node_modules", pkg))) fail(`${pkg} is missing from the standalone build.`);
}

const res = path.join(root, "electron", "resources");
fs.mkdirSync(res, { recursive: true });
await sharp(path.join(root, "electron", "icon.svg")).resize(1024, 1024).png().toFile(path.join(res, "icon.png"));

console.log("prepare-app: standalone folder ready, icon made.");
