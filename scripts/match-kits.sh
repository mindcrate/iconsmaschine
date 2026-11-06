#!/usr/bin/env bash
# Works out how an NI Resources/image folder maps to content in Maschine's
# browser: by bank chain, by vendor, and under what name normalisation.
#
# Exact lowercase comparison is too strict - "abbey road 60s drummer" matches
# while "abbey road 60s drums" does not, and punctuation differences hide real
# pairs. This reports match rates at three strictnesses and shows the pairs
# that only appear once names are normalised, which reveals the actual rule.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? "/Users/Shared/NI Resources/image";
const dbPath =
  process.env.MASCHINE_DB_PATH ??
  path.join(os.homedir(), "Library/Application Support/Native Instruments/Maschine 2/komplete.db3");

if (!fs.existsSync(imageDir)) { console.log("No image dir at " + imageDir); process.exit(0); }
if (!fs.existsSync(dbPath)) { console.log("No komplete.db3 at " + dbPath); process.exit(0); }

const lower = (s) => s.trim().toLowerCase();
/** Strips punctuation and collapses whitespace: "Bumpin' Flava" -> "bumpin flava" */
const loose = (s) => lower(s).replace(/[^a-z0-9]+/g, " ").trim();
/** Removes spaces too: "bumpin flava" -> "bumpinflava" */
const tight = (s) => lower(s).replace(/[^a-z0-9]+/g, "");

const folders = fs
  .readdirSync(imageDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .map((e) => e.name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-match-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);
// SQLite keeps recent writes in a -wal sidecar until a checkpoint, which
// Maschine only does on quit. Copying the .db3 alone reads whatever was true
// at the last checkpoint - days old, in practice. Bring the sidecars.
for (const ext of ["-wal", "-shm"]) {
  try { fs.copyFileSync(dbPath + ext, copy + ext); } catch {}
}

try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(copy);

  const chains = db
    .prepare("SELECT id, bcvendor, entry1, entry2 FROM k_bank_chain")
    .all()
    .map((r) => ({
      id: r.id,
      vendor: (r.bcvendor ?? "").trim(),
      e1: (r.entry1 ?? "").trim(),
      e2: (r.entry2 ?? "").trim(),
    }))
    .filter((c) => c.e1 && !c.e1.startsWith("/"));

  const counts = new Map();
  for (const r of db.prepare(
    "SELECT bank_chain_id AS id, COUNT(*) AS n FROM k_sound_info GROUP BY bank_chain_id",
  ).all()) counts.set(r.id, r.n);

  // Index folders at each strictness.
  const idx = { exact: new Map(), loose: new Map(), tight: new Map() };
  for (const f of folders) {
    for (const [k, fn] of [["exact", lower], ["loose", loose], ["tight", tight]]) {
      const key = fn(f);
      if (!idx[k].has(key)) idx[k].set(key, f);
    }
  }

  const rate = (fn, key, pick) => {
    const hit = new Set();
    for (const c of chains) {
      const v = pick(c);
      if (v && idx[key].has(fn(v))) hit.add(c.id);
    }
    return hit.size;
  };

  console.log("===== Match rates (of " + chains.length + " bank chains) =====");
  console.log("                        exact   loose   no-spaces");
  console.log(
    "  by bank chain entry1 " +
      String(rate(lower, "exact", (c) => c.e1)).padStart(6) +
      String(rate(loose, "loose", (c) => c.e1)).padStart(8) +
      String(rate(tight, "tight", (c) => c.e1)).padStart(10),
  );
  console.log(
    "  by vendor            " +
      String(rate(lower, "exact", (c) => c.vendor)).padStart(6) +
      String(rate(loose, "loose", (c) => c.vendor)).padStart(8) +
      String(rate(tight, "tight", (c) => c.vendor)).padStart(10),
  );

  console.log("\n===== Pairs that only match once names are normalised =====");
  console.log("  (these show what rule NI is actually using)\n");
  let shown = 0;
  for (const c of chains) {
    if (shown >= 15) break;
    const ex = idx.exact.get(lower(c.e1));
    const lo = idx.loose.get(loose(c.e1));
    if (!ex && lo) {
      console.log(`  chain ${JSON.stringify(c.e1)}`);
      console.log(`     -> folder ${JSON.stringify(lo)}`);
      shown++;
    }
  }
  if (shown === 0) console.log("  (none - normalisation changes nothing)");

  console.log("\n===== Big kits still with no folder, at the loosest matching =====");
  const unmatched = chains
    .filter((c) => !idx.tight.has(tight(c.e1)) && !(c.vendor && idx.tight.has(tight(c.vendor))))
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  const seen = new Set();
  let n = 0;
  for (const c of unmatched) {
    const key = tight(c.e1);
    if (seen.has(key)) continue;
    seen.add(key);
    if (n++ >= 20) break;
    console.log(
      `  ${c.e1.padEnd(42)} ${String(counts.get(c.id) ?? 0).padStart(5)} sounds` +
        (c.vendor ? `  vendor=${JSON.stringify(c.vendor)}` : "  (no vendor)"),
    );
  }
  console.log(`\n  ${seen.size} distinct names unmatched in total`);

  db.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
