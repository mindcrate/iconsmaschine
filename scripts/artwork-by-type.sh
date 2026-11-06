#!/usr/bin/env bash
# Answers one question: does Maschine ever show artwork for SAMPLES
# (one-shots and loops), or only for Groups, Sounds and Instruments?
#
# Cross-tabulates every bank chain by what content it holds against whether it
# has an image folder. If sample-only products essentially never have one while
# group-bearing products do, then no folder name will ever work for samples -
# and that is worth knowing before chasing it further.
#
# CAVEAT: this counts a folder as artwork merely because it exists, so its
# tally is optimistic - an empty folder counts. scripts/why-samples.sh checks
# for the actual files and reports which candidate folder matched; prefer it
# when the question is why a particular product shows nothing.
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

const classify = (flags, ext) => {
  const e = String(ext ?? "").toLowerCase();
  if (flags === 0) return e === "mxgrp" ? "group" : e === "mxsnd" ? "sound" : "other";
  if (flags & 4) return "oneshot";
  if (flags & 8) return "loop";
  if (flags & 1) return "instrument";
  if (flags & 2) return "effect";
  return "other";
};
const groupOf = (t) =>
  t === "group" || t === "sound" ? "groups"
  : t === "oneshot" || t === "loop" ? "samples"
  : t === "instrument" ? "instruments"
  : t === "effect" ? "effects" : "other";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-abt-"));
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

  const chainName = new Map();
  const chainVendor = new Map();
  for (const r of d.prepare("SELECT id, bcvendor, entry1 FROM k_bank_chain").all()) {
    const n = String(r.entry1 ?? "").trim();
    if (!n || n.startsWith("/")) continue;
    chainName.set(Number(r.id), n);
    chainVendor.set(Number(r.id), String(r.bcvendor ?? "").trim());
  }

  // name -> { groups:Set, counts:{} }
  const byName = new Map();
  for (const r of d.prepare(
    `SELECT bank_chain_id AS id, device_type_flags AS flags, file_ext AS ext, COUNT(*) AS n
     FROM k_sound_info GROUP BY bank_chain_id, device_type_flags, file_ext`,
  ).all()) {
    const name = chainName.get(Number(r.id));
    if (!name) continue;
    const key = name.toLowerCase();
    const e = byName.get(key) ?? { name, groups: new Set(), total: 0, vendor: chainVendor.get(Number(r.id)) || "" };
    e.groups.add(groupOf(classify(Number(r.flags ?? 0), r.ext)));
    e.total += Number(r.n ?? 0);
    if (!e.vendor) e.vendor = chainVendor.get(Number(r.id)) || "";
    byName.set(key, e);
  }

  const hasArt = (key, vendor) =>
    folders.has(key) || (vendor && folders.has(vendor.toLowerCase()));

  const buckets = new Map();
  for (const [key, e] of byName) {
    const shape =
      e.groups.has("groups") ? "has Groups/Sounds"
      : e.groups.has("instruments") ? "Instruments only"
      : e.groups.has("effects") ? "Effects only"
      : e.groups.has("samples") ? "SAMPLES ONLY (one-shots/loops)"
      : "other";
    const b = buckets.get(shape) ?? { withArt: 0, without: 0, examplesWith: [], examplesWithout: [] };
    if (hasArt(key, e.vendor)) {
      b.withArt++;
      if (b.examplesWith.length < 5) b.examplesWith.push(e.name);
    } else {
      b.without++;
      if (b.examplesWithout.length < 5) b.examplesWithout.push(e.name);
    }
    buckets.set(shape, b);
  }

  console.log("===== Artwork presence by what the product contains =====");
  console.log("  (a product 'has artwork' if an image folder matches its name or vendor)\n");
  for (const [shape, b] of [...buckets].sort((a, b2) => (b2[1].withArt + b2[1].without) - (a[1].withArt + a[1].without))) {
    const total = b.withArt + b.without;
    const pct = total ? Math.round((100 * b.withArt) / total) : 0;
    console.log(`  ${shape.padEnd(32)} ${String(b.withArt).padStart(4)} with / ${String(total).padStart(4)} total  (${pct}%)`);
    if (b.examplesWith.length) console.log(`      with artwork:    ${b.examplesWith.join(", ")}`);
    if (b.examplesWithout.length) console.log(`      without artwork: ${b.examplesWithout.join(", ")}`);
    console.log();
  }

  console.log("===== Sample-only products that DO have an image folder =====");
  console.log("  (if this list is empty, samples never show artwork)\n");
  let n = 0;
  for (const [key, e] of byName) {
    if (e.groups.has("groups") || e.groups.has("instruments") || e.groups.has("effects")) continue;
    if (!hasArt(key, e.vendor)) continue;
    if (n++ >= 15) break;
    console.log(`  ${e.name.padEnd(40)} ${e.total.toLocaleString().padStart(7)} samples  vendor=${JSON.stringify(e.vendor)}`);
  }
  if (n === 0) console.log("  (none)");

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
