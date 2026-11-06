#!/usr/bin/env bash
# Which key does an image folder match: the bank chain name, or the vendor?
#
# The earlier cross-tab counted a match on either, so it could not tell them
# apart. This reports each separately, and focuses on the products where the
# two names DIFFER - those are the only ones that can settle it.
#
# Also compares MSXII (which has artwork) against MSXIII (which does not), and
# counts how many sounds in each carry a vendor, since setting the vendor on
# one selected item would only change one row.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? "/Users/Shared/NI Resources/image";
/**
 * The browser database Maschine is actually writing.
 *
 * Not a fixed path: on a machine running Maschine 3, the Maschine 2 file still
 * exists, is bigger, has more bank chains, and stopped being written when
 * Maschine 3 took over. Pick the most recently written instead, counting the
 * -wal, since changes sit there until a checkpoint.
 */
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
if (!fs.existsSync(dbPath)) { console.log("No komplete.db3 at " + dbPath); process.exit(0); }

const folders = new Set(
  (fs.existsSync(imageDir) ? fs.readdirSync(imageDir, { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name.toLowerCase()),
);
const has = (s) => Boolean(s) && folders.has(String(s).trim().toLowerCase());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-wk-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);
// SQLite keeps recent writes in a -wal sidecar until a checkpoint, which
// Maschine only does on quit. Copying the .db3 alone reads whatever was true
// at the last checkpoint - days old, in practice. Bring the sidecars.
for (const ext of ["-wal", "-shm"]) {
  try { fs.copyFileSync(dbPath + ext, copy + ext); } catch {}
}

try {
  const d = new DatabaseSync(copy);

  const chains = d.prepare("SELECT id, bcvendor, entry1 FROM k_bank_chain").all()
    .map((r) => ({
      id: Number(r.id),
      vendor: String(r.bcvendor ?? "").trim(),
      name: String(r.entry1 ?? "").trim(),
    }))
    .filter((c) => c.name && !c.name.startsWith("/"));

  const isSample = new Map();
  for (const r of d.prepare(
    `SELECT bank_chain_id AS id, device_type_flags AS flags, COUNT(*) AS n
     FROM k_sound_info GROUP BY bank_chain_id, device_type_flags`,
  ).all()) {
    const f = Number(r.flags ?? 0);
    const e = isSample.get(Number(r.id)) ?? { sample: 0, other: 0 };
    if (f & 12) e.sample += Number(r.n); else e.other += Number(r.n);
    isSample.set(Number(r.id), e);
  }

  console.log("===== Products where the NAME and the VENDOR differ =====");
  console.log("  Only these can tell us which key Maschine matches on.\n");
  console.log("  name-folder  vendor-folder  content   product / vendor");
  let nameOnly = 0, vendorOnly = 0, both = 0, neither = 0, shown = 0;
  for (const c of chains) {
    if (!c.vendor || c.vendor.toLowerCase() === c.name.toLowerCase()) continue;
    const counts = isSample.get(c.id);
    if (!counts || counts.sample + counts.other === 0) continue;
    const kind = counts.sample > counts.other ? "samples" : "other";
    const n = has(c.name), v = has(c.vendor);
    if (n && v) both++; else if (n) nameOnly++; else if (v) vendorOnly++; else neither++;
    if (kind === "samples" && shown < 20) {
      shown++;
      console.log(
        `      ${n ? "YES" : " - "}          ${v ? "YES" : " - "}        ${kind.padEnd(8)} ` +
        `${c.name} / ${c.vendor}`,
      );
    }
  }
  console.log(`\n  across all such products:  name only ${nameOnly}   vendor only ${vendorOnly}   both ${both}   neither ${neither}`);

  console.log("\n===== MSXII (works) vs MSXIII (does not) =====\n");
  for (const target of ["msxii", "msxiii"]) {
    const matches = chains.filter((c) => c.name.toLowerCase() === target);
    if (matches.length === 0) { console.log(`  ${target}: no bank chain with that name`); continue; }
    for (const c of matches) {
      const counts = isSample.get(c.id) ?? { sample: 0, other: 0 };
      console.log(`  chain ${c.id}  name=${JSON.stringify(c.name)}  vendor=${JSON.stringify(c.vendor)}`);
      console.log(`     samples=${counts.sample}  other=${counts.other}`);
      console.log(`     image/${c.name.toLowerCase()}/ exists: ${has(c.name)}`);
      console.log(`     image/${(c.vendor || "(none)").toLowerCase()}/ exists: ${has(c.vendor)}`);

      // How many of this chain's sounds actually carry a vendor? Setting it on
      // one selected item in the browser would only change one row.
      const rows = d.prepare(
        `SELECT vendor, COUNT(*) AS n FROM k_sound_info WHERE bank_chain_id = ? GROUP BY vendor ORDER BY n DESC LIMIT 5`,
      ).all(c.id);
      console.log("     vendor set on its sounds:");
      for (const r of rows) {
        console.log(`        ${JSON.stringify(r.vendor ?? null).padEnd(28)} ${r.n}`);
      }
      console.log();
    }
  }

  console.log("===== image/ folders that look related =====");
  for (const f of [...folders].filter((f) => f.includes("msx") || f.includes("moose")).slice(0, 10)) {
    console.log("  " + f);
  }

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
