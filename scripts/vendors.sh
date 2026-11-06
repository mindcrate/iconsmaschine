#!/usr/bin/env bash
# Finds a THIRD-PARTY library that already displays artwork, so its setup can
# be copied instead of guessed at.
#
#   ./scripts/vendors.sh
#
# Groups every bank chain by the vendor heading the browser files it under,
# and for each heading reports how many chains it holds, where their audio
# lives, and whether artwork exists flat, nested, or not at all.
#
# The question it answers: on THIS install, does any vendor other than Native
# Instruments have artwork that works - and if so, what is different about it?
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function liveMaschineDb() {
  if (process.env.MASCHINE_DB_PATH) return process.env.MASCHINE_DB_PATH;
  const roots = [
    path.join(os.homedir(), "Library/Application Support/Native Instruments"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Native Instruments") : "",
  ].filter(Boolean);
  let best = null;
  for (const r of roots) {
    let apps;
    try {
      apps = fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch { continue; }
    for (const a of apps) {
      const p = path.join(r, a.name, "komplete.db3");
      let when = 0;
      for (const ext of ["", "-wal"]) {
        try { when = Math.max(when, fs.statSync(p + ext).mtimeMs); }
        catch { if (!ext) break; }
      }
      if (when > 0 && (!best || when > best.when)) best = { p, when };
    }
  }
  return best ? best.p : "";
}

const dbPath = liveMaschineDb();
if (!dbPath || !fs.existsSync(dbPath)) { console.log("No komplete.db3 found"); process.exit(1); }
const root = process.env.NI_RESOURCES_DIR ?? "/Users/Shared/NI Resources";
const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? path.join(root, "image");

const ART = new Set(
  ["MST_artwork.png","MST_logo.png","MST_plugin.png","VB_artwork.png","VB_logo.png",
   "OSO_logo.png","NKS2_hardware_banner.webp","NKS2_hardware_banner_1280x152.webp"]
    .map((f) => f.toLowerCase()),
);
const artCount = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && ART.has(e.name.toLowerCase())).length;
  } catch { return -1; }
};
const fold = (s: string) => s.trim().toLowerCase();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-vend-"));
try {
  const copy = path.join(tmp, "s.db3");
  fs.copyFileSync(dbPath, copy);
  for (const ext of ["-wal", "-shm"]) {
    try { fs.copyFileSync(dbPath + ext, copy + ext); } catch {}
  }
  const d = new DatabaseSync(copy);
  console.log(`Database: ${dbPath}\n`);

  const cols = new Set(
    d.prepare("PRAGMA table_info(k_sound_info)").all().map((r) => String(r.name)),
  );
  const hasVendor = cols.has("vendor");
  const hasPath = cols.has("content_path_id");

  const chains = d.prepare("SELECT id, bcvendor, entry1 FROM k_bank_chain").all();

  // Where each chain's audio lives, so installed and user content can be told
  // apart - that is what decides flat versus nested.
  const where = new Map<number, string>();
  if (hasPath) {
    for (const r of d.prepare(
      `SELECT DISTINCT s.bank_chain_id AS id, p.path AS path
       FROM k_sound_info s JOIN k_content_path p ON p.id = s.content_path_id`,
    ).all()) {
      const p = String(r.path ?? "");
      if (!p) continue;
      const installed = ["/Users/Shared/", "/Library/", "/Applications/"].some((x) => p.startsWith(x));
      where.set(Number(r.id), installed ? "installed" : "yours");
    }
  }

  const soundVendor = new Map<number, string>();
  if (hasVendor) {
    for (const r of d.prepare(
      `SELECT bank_chain_id AS id, vendor AS v, COUNT(*) AS n
       FROM k_sound_info WHERE vendor IS NOT NULL AND vendor != ''
       GROUP BY bank_chain_id, vendor`,
    ).all()) {
      soundVendor.set(Number(r.id), String(r.v ?? "").trim());
    }
  }

  interface G { chains: number; flat: number; nested: number; none: number; yours: number; installed: number; sample: string[] }
  const groups = new Map<string, G>();
  for (const c of chains) {
    const id = Number(c.id);
    const name = String(c.entry1 ?? "").trim();
    if (!name || name.startsWith("/")) continue;
    const heading = String(c.bcvendor ?? "").trim() || "(blank)";
    const g = groups.get(heading) ?? { chains: 0, flat: 0, nested: 0, none: 0, yours: 0, installed: 0, sample: [] };
    g.chains += 1;
    const w = where.get(id);
    if (w === "yours") g.yours += 1;
    else if (w === "installed") g.installed += 1;

    const flatN = artCount(path.join(imageDir, fold(name)));
    const vend = soundVendor.get(id) || (heading !== "Other" && heading !== "(blank)" ? heading : "");
    const nestN = vend ? artCount(path.join(imageDir, fold(vend), fold(name))) : -1;
    if (nestN > 0) { g.nested += 1; if (g.sample.length < 3) g.sample.push(`${name} -> image/${fold(vend)}/${fold(name)}/`); }
    else if (flatN > 0) { g.flat += 1; if (g.sample.length < 3) g.sample.push(`${name} -> image/${fold(name)}/`); }
    else g.none += 1;
    groups.set(heading, g);
  }

  // "Other" and a blank heading mean no vendor heading at all.
  const NOT_A_VENDOR = new Set(["native instruments", "other", "(blank)"]);

  const rows = [...groups].sort((a, b) => (b[1].flat + b[1].nested) - (a[1].flat + a[1].nested) || b[1].chains - a[1].chains);
  const pad = (s: unknown, w: number) => String(s).slice(0, w).padEnd(w);
  console.log(`${pad("browser heading", 26)} ${pad("chains", 7)} ${pad("flat", 6)} ${pad("nested", 7)} ${pad("none", 6)} ${pad("yours", 6)} installed`);
  console.log("-".repeat(80));
  for (const [h, g] of rows) {
    console.log(`${pad(h, 26)} ${pad(g.chains, 7)} ${pad(g.flat, 6)} ${pad(g.nested, 7)} ${pad(g.none, 6)} ${pad(g.yours, 6)} ${g.installed}`);
  }

  // The coarse per-heading view above cannot answer the real question: it
  // counts a heading as working if ANY of its chains has artwork and ANY of
  // its content is the user's, which for a plugin vendor is two different
  // chains. Tie them together per chain instead.
  console.log("\n" + "=".repeat(80));
  console.log("YOUR OWN content - audio outside the installed trees - by artwork");
  console.log("=".repeat(80));

  interface Row { name: string; heading: string; vendor: string; at: string }
  const mine: Row[] = [];
  const mineNone: Row[] = [];
  for (const c of chains) {
    const id = Number(c.id);
    const name = String(c.entry1 ?? "").trim();
    if (!name || name.startsWith("/")) continue;
    if (where.get(id) !== "yours") continue;
    const heading = String(c.bcvendor ?? "").trim() || "(blank)";
    const vend = soundVendor.get(id) || (NOT_A_VENDOR.has(heading.toLowerCase()) ? "" : heading);
    const flatN = artCount(path.join(imageDir, fold(name)));
    const nestN = vend ? artCount(path.join(imageDir, fold(vend), fold(name))) : -1;
    const row = { name, heading, vendor: vend || "(none)", at: "" };
    if (nestN > 0) { row.at = `image/${fold(vend)}/${fold(name)}/ (${nestN} files)`; mine.push(row); }
    else if (flatN > 0) { row.at = `image/${fold(name)}/ (${flatN} files)`; mine.push(row); }
    else mineNone.push(row);
  }

  const seen = new Set<string>();
  const uniq = mine.filter((r) => {
    const k = `${r.name}|${r.at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`${mine.length} of ${mine.length + mineNone.length} such chains have artwork on disk.\n`);
  if (uniq.length > 0) {
    console.log(`${pad("library", 30)} ${pad("heading", 20)} ${pad("vendor", 16)} artwork at`);
    console.log("-".repeat(96));
    for (const r of uniq.slice(0, 40)) {
      console.log(`${pad(r.name, 30)} ${pad(r.heading, 20)} ${pad(r.vendor, 16)} ${r.at}`);
    }
    if (uniq.length > 40) console.log(`  ... and ${uniq.length - 40} more`);
    console.log("\nCheck one of these in Maschine's browser. If any DISPLAYS its artwork,");
    console.log("that is the example to copy and the layout question is settled. If none");
    console.log("does, folders on disk prove nothing and the answer is elsewhere.");
  } else {
    console.log("None. No library of your own has artwork anywhere we would look,");
    console.log("so there is no working example on this machine to copy.");
  }

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
NODE
