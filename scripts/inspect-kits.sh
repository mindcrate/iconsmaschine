#!/usr/bin/env bash
# Read-only survey of Maschine Groups, Sounds and user kits.
#
# The question this answers: are Groups/Sounds the same RIFF/NIKS containers
# as .nksf presets? If so, the vendor and tag machinery already built applies
# to them directly. If not, they need their own handling.
#
# It only reads. It writes, changes and deletes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const roots = [
  path.join(home, "Documents", "Native Instruments", "Maschine 2"),
  path.join(home, "Documents", "Native Instruments", "User Content"),
  "/Users/Shared/Native Instruments",
  "/Users/Shared/Maschine 2 Library",
  path.join(home, "Music", "Native Instruments"),
].filter((p) => fs.existsSync(p));

const KIT_EXT = new Set([".mxgrp", ".mxsnd", ".mxprj", ".nksn", ".nksf", ".nksfx", ".mxinst"]);

console.log("===== Roots that exist =====");
for (const r of roots) console.log("  " + r);
if (roots.length === 0) console.log("  (none found)");

const found = new Map();           // extension -> sample paths
const walk = (dir, depth) => {
  if (depth > 5) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, depth + 1); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (!KIT_EXT.has(ext)) continue;
    const list = found.get(ext) ?? [];
    if (list.length < 400) list.push(full);
    found.set(ext, list);
  }
};
for (const r of roots) walk(r, 0);

console.log("\n===== What was found =====");
if (found.size === 0) console.log("  No Maschine Group/Sound/preset files found.");
for (const [ext, list] of [...found].sort()) {
  console.log(`  ${ext.padEnd(8)} ${list.length} file(s)`);
}

/** Is this a RIFF/NIKS container like a .nksf preset? */
function probe(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(4096);
  const n = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n);
  const riff = head.toString("ascii", 0, 4);
  const form = head.toString("ascii", 8, 12);
  const tags = [];
  for (let i = 12; i < n - 8; ) {
    const id = head.toString("ascii", i, i + 4);
    if (!/^[A-Za-z0-9]{4}$/.test(id)) break;
    const size = head.readUInt32LE(i + 4);
    tags.push(`${id}(${size})`);
    if (tags.length > 6) break;
    i += 8 + size + (size % 2);
    if (i > n) break;
  }
  const text = head.toString("latin1");
  const keys = ["vendor", "bankchain", "types", "characters", "deviceType", "name"]
    .filter((k) => text.includes(k));
  return { riff, form, tags, keys };
}

console.log("\n===== Container format, one sample per extension =====");
for (const [ext, list] of [...found].sort()) {
  const file = list[0];
  console.log(`\n--- ${ext} ---`);
  console.log("  " + file.replace(home, "~"));
  try {
    const { riff, form, tags, keys } = probe(file);
    const isNks = riff === "RIFF" && form === "NIKS";
    console.log(`  header: ${JSON.stringify(riff)} / form ${JSON.stringify(form)}`);
    console.log(`  chunks: ${tags.join(" ") || "(none parsed)"}`);
    console.log(`  NKS metadata keys present: ${keys.join(", ") || "(none)"}`);
    console.log(`  >>> ${isNks ? "SAME CONTAINER AS .nksf - the existing editor applies" : "DIFFERENT FORMAT - needs its own handling"}`);
  } catch (e) {
    console.log("  (unreadable: " + e.message + ")");
  }
}

console.log("\n===== How Maschine records user content =====");
// Maschine 3's database by name. Maschine 2's beside it is bigger and gets a
// fresh write each time Maschine 2 is opened, so "newest" picks wrong.
const m3Db = path.join(home, "Library/Application Support/Native Instruments/Maschine 3/komplete.db3");
const db = process.env.MASCHINE_DB_PATH ?? (fs.existsSync(m3Db) ? m3Db : "");
if (!db) {
  console.log("  komplete.db3 not found");
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-kits-"));
  const copy = path.join(dir, "s.db3");
  fs.copyFileSync(db, copy);
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(copy);
    const cols = d.prepare("PRAGMA table_info(k_sound_info)").all().map((c) => c.name);
    console.log("  k_sound_info columns: " + cols.join(", "));
    const n = d.prepare("SELECT COUNT(*) AS n FROM k_sound_info").all()[0].n;
    console.log(`  rows: ${n}`);
    // Which bank chains have no vendor? Those are the ones that cannot resolve artwork.
    const noVendor = d.prepare(
      "SELECT COUNT(*) AS n FROM k_bank_chain WHERE bcvendor IS NULL OR bcvendor = ''",
    ).all()[0].n;
    const withVendor = d.prepare(
      "SELECT COUNT(*) AS n FROM k_bank_chain WHERE bcvendor IS NOT NULL AND bcvendor != ''",
    ).all()[0].n;
    console.log(`  bank chains WITH a vendor:    ${withVendor}`);
    console.log(`  bank chains WITHOUT a vendor: ${noVendor}   <- these cannot resolve artwork by vendor`);
    console.log("\n  sample of vendor-less bank chains:");
    for (const r of d.prepare(
      "SELECT entry1, entry2 FROM k_bank_chain WHERE bcvendor IS NULL OR bcvendor = '' LIMIT 8",
    ).all()) {
      console.log(`    ${JSON.stringify(r.entry1)} / ${JSON.stringify(r.entry2)}`);
    }
    d.close();
  } catch (e) {
    console.log("  (could not read: " + e.message + ")");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n===== Done - nothing was modified =====");
NODE
