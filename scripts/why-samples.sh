#!/usr/bin/env bash
# Settles one question with data instead of guesswork: what do the SAMPLE
# libraries that already show artwork have, that a folder of WAVs you dropped
# in the browser does not?
#
# For every bank chain holding one-shots or loops it reports, side by side:
#   - where the content actually lives (an installed library location, or a
#     folder of your own)
#   - whether image/<folder> holds real artwork FILES (an empty folder is
#     counted as empty, not as artwork - scripts/artwork-by-type.sh checked
#     only that the folder existed, so its tally was optimistic)
#   - whether dist_database/<...>/<folder> exists
#
# The app currently writes a dist_database entry for plugins only, on the
# assumption that expansions and sample kits live in image/ alone. If the
# sample products that work all carry a dist_database entry and the ones that
# do not are exactly the ones showing nothing, that assumption is the bug.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.NI_RESOURCES_DIR ?? "/Users/Shared/NI Resources";
const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? path.join(root, "image");
const distDir = process.env.NI_RESOURCES_DIST_DIR ?? path.join(root, "dist_database");
const dbPath =
  process.env.MASCHINE_DB_PATH ??
  path.join(os.homedir(), "Library/Application Support/Native Instruments/Maschine 2/komplete.db3");
if (!fs.existsSync(dbPath)) { console.log("No komplete.db3 at " + dbPath); process.exit(1); }

const dirs = (p) =>
  fs.existsSync(p)
    ? fs.readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
    : [];

// The files we and NI write. A folder without at least one of them is empty
// as far as Maschine is concerned, however promising its name.
const artFiles = new Set(
  [
    "MST_artwork.png", "MST_logo.png", "MST_plugin.png",
    "VB_artwork.png", "VB_logo.png", "OSO_logo.png",
    "NKS2_hardware_banner.webp", "NKS2_hardware_banner_1280x152.webp",
  ].map((f) => f.toLowerCase()),
);
const holdsArt = (p) => {
  let entries;
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && artFiles.has(e.name.toLowerCase()))) return true;
  return entries.some((e) => e.isDirectory() && !e.name.startsWith(".") && holdsArt(path.join(p, e.name)));
};

// image/ is one level for expansions, two for plugins.
const imageFolders = new Set();
const emptyFolders = new Set();
for (const a of dirs(imageDir)) {
  (holdsArt(path.join(imageDir, a)) ? imageFolders : emptyFolders).add(a.toLowerCase());
  for (const b of dirs(path.join(imageDir, a))) {
    (holdsArt(path.join(imageDir, a, b)) ? imageFolders : emptyFolders).add(b.toLowerCase());
  }
}
// dist_database/ is <vendor>/<product>/.
const distFolders = new Set();
for (const a of dirs(distDir)) {
  distFolders.add(a.toLowerCase());
  for (const b of dirs(path.join(distDir, a))) distFolders.add(b.toLowerCase());
}

const folderName = (s) =>
  String(s ?? "").trim().toLowerCase().replace(/[\/\\:]/g, " ").replace(/\s+/g, " ").trim();

const home = os.homedir();
const whereClass = (p) => {
  if (!p) return "?";
  if (p.startsWith("/Users/Shared/")) return "shared";
  if (p.startsWith("/Library/")) return "library";
  if (p.startsWith("/Applications/")) return "apps";
  if (p.startsWith(home + "/Library/")) return "userlib";
  if (p.startsWith(home + "/Documents/Native Instruments")) return "nidocs";
  if (p.startsWith(home + "/")) return "mine";
  if (p.startsWith("/Volumes/")) return "volume";
  return "other";
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-ws-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);

try {
  const d = new DatabaseSync(copy);

  const chains = new Map();
  for (const r of d.prepare("SELECT id, bcvendor, entry1 FROM k_bank_chain").all()) {
    const n = String(r.entry1 ?? "").trim();
    if (!n || n.startsWith("/")) continue;
    chains.set(Number(r.id), { name: n, vendor: String(r.bcvendor ?? "").trim() });
  }

  const pathOf = new Map();
  try {
    for (const r of d.prepare("SELECT id, path FROM k_content_path").all()) {
      pathOf.set(Number(r.id), String(r.path ?? ""));
    }
  } catch {
    console.log("(no k_content_path table - the 'where' column will read '?')\n");
  }

  // Per-type partitions: gather sound rows wherever they live.
  const tables = d
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name='k_sound_info' OR name LIKE 'p_sound_info_%')")
    .all()
    .map((r) => String(r.name));

  const agg = new Map(); // chain id -> { n, flags:Set, paths:Set, vendors:Set }
  for (const t of tables) {
    let rows;
    try {
      rows = d.prepare(
        `SELECT bank_chain_id AS c, device_type_flags AS f, content_path_id AS p, vendor AS v FROM ${t}`,
      ).all();
    } catch { continue; }
    for (const r of rows) {
      const flags = Number(r.f ?? 0);
      if (!(flags & 12)) continue; // one-shots and loops only
      const c = Number(r.c ?? 0);
      let a = agg.get(c);
      if (!a) agg.set(c, (a = { n: 0, paths: new Set(), vendors: new Set() }));
      a.n += 1;
      const p = pathOf.get(Number(r.p ?? 0));
      if (p) a.paths.add(p);
      const v = String(r.v ?? "").trim();
      if (v) a.vendors.add(v);
    }
  }

  const rows = [];
  for (const [id, a] of agg) {
    const c = chains.get(id);
    if (!c) continue;
    const vendor = [...a.vendors][0] ?? c.vendor;
    const nf = folderName(c.name);
    const vf = vendor ? folderName(vendor) : "";
    // Which candidate actually holds artwork matters: Maschine resolves by
    // vendor where there is one, so art filed under the product name while the
    // vendor folder sits empty is art Maschine never looks at.
    const viaVendor = !!vf && imageFolders.has(vf);
    const viaName = imageFolders.has(nf);
    const img = viaVendor || viaName;
    const via = viaVendor ? "vendor" : viaName ? "name" : "-";
    const vendorEmpty = !!vf && !viaVendor && emptyFolders.has(vf);
    const empty = !img && (emptyFolders.has(nf) || vendorEmpty);
    const dist =
      distFolders.has(folderName(c.name)) || (vendor && distFolders.has(folderName(vendor)));
    const wheres = new Set([...a.paths].map(whereClass));
    rows.push({
      id, name: c.name, vendor, n: a.n, img, empty, via, vendorEmpty, dist,
      where: [...wheres].sort().join(",") || "?",
    });
  }
  rows.sort((x, y) => Number(y.img) - Number(x.img) || y.n - x.n);

  const pad = (s, w) => String(s).slice(0, w).padEnd(w);
  console.log(`${rows.length} bank chains hold one-shots or loops\n`);
  console.log(`${pad("product", 28)} ${pad("vendor", 20)} ${pad("n", 6)} ${pad("image", 6)} ${pad("via", 7)} ${pad("distdb", 7)} where`);
  console.log("-".repeat(80));
  for (const r of rows) {
    const img = r.img ? "yes" : r.empty ? "EMPTY" : "-";
    console.log(
      `${pad(r.name, 28)} ${pad(r.vendor, 20)} ${pad(r.n, 6)} ${pad(img, 6)} ${pad(r.via, 7)} ${pad(r.dist ? "yes" : "-", 7)} ${r.where}`,
    );
  }

  const cross = new Map();
  for (const r of rows) {
    const k = `image=${pad(r.img ? "yes" : r.empty ? "empty" : "no", 5)}  distdb=${r.dist ? "yes" : "no "}  where=${r.where}`;
    cross.set(k, (cross.get(k) ?? 0) + 1);
  }
  console.log("\nCross-tab");
  console.log("-".repeat(80));
  for (const [k, v] of [...cross].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(4)}  ${k}`);
  }

  if (rows.length === 0) {
    console.log("\nNo sample-bearing bank chains found, so there is nothing to compare.");
  } else {
    const misfiled = rows.filter((r) => r.via === "name" && r.vendorEmpty);
    if (misfiled.length) {
      console.log(
        `\n${misfiled.length} sample product(s) have artwork filed under the PRODUCT name while the`,
      );
      console.log("VENDOR folder they resolve to is empty - so Maschine finds nothing:");
      for (const r of misfiled) {
        console.log(`  ${r.name}: art in image/${folderName(r.name)}/, but resolves to image/${folderName(r.vendor)}/ (empty)`);
      }
      console.log("  Fix either end: file the art under the vendor, or change the content's Vendor.");
    }

    const empties = rows.filter((r) => r.empty);
    if (empties.length) {
      console.log(
        `\n${empties.length} sample product(s) resolve to a folder that exists but holds NO artwork files:`,
      );
      for (const r of empties) console.log(`  ${r.name}  (vendor "${r.vendor}")`);
      console.log("  These look done if you only check that the folder is there. It is not.");
    }
    const imgNoDist = rows.filter((r) => r.img && !r.dist).length;
    const imgAndDist = rows.filter((r) => r.img && r.dist).length;
    console.log(
      `\nSample products with real artwork files: ${imgNoDist} have NO dist_database entry, ${imgAndDist} have one.`,
    );
    console.log(
      imgNoDist >= imgAndDist
        ? "=> dist_database is NOT what the working sample products carry. Look elsewhere."
        : "=> the working sample products carry a dist_database entry; the app should write one for sample kits too.",
    );
  }
  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
NODE
