#!/usr/bin/env bash
# Tests one hypothesis: for library content, an NI Resources/image folder is
# named after the BANK CHAIN (lowercased), not the vendor.
#
# If true, a user sample kit needs no file edit at all - it needs an image
# folder named after its bank chain. That would close the sample-kit case.
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

const folders = fs
  .readdirSync(imageDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .map((e) => e.name);
const folderSet = new Set(folders.map((f) => f.toLowerCase()));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-match-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);

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
    .filter((c) => c.e1);

  // How many sounds sit on each chain? A chain with content is one that matters.
  const counts = new Map();
  for (const r of db.prepare(
    "SELECT bank_chain_id AS id, COUNT(*) AS n FROM k_sound_info GROUP BY bank_chain_id",
  ).all()) {
    counts.set(r.id, r.n);
  }

  const matchedByChain = chains.filter((c) => folderSet.has(c.e1.toLowerCase()));
  const matchedByVendor = chains.filter((c) => c.vendor && folderSet.has(c.vendor.toLowerCase()));

  console.log("===== The test =====");
  console.log(`  image/ folders:            ${folders.length}`);
  console.log(`  bank chains:               ${chains.length}`);
  console.log(`  chains whose ENTRY1 matches a folder: ${matchedByChain.length}`);
  console.log(`  chains whose VENDOR matches a folder: ${matchedByVendor.length}`);

  console.log("\n===== Folders matched by bank chain (proof, if any) =====");
  for (const c of matchedByChain.slice(0, 12)) {
    console.log(
      `  image/${c.e1.toLowerCase().padEnd(34)} <- chain "${c.e1}"` +
        (c.vendor ? ` (vendor "${c.vendor}")` : " (NO vendor)"),
    );
  }

  const unmatched = chains
    .filter((c) => !folderSet.has(c.e1.toLowerCase()))
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));

  console.log("\n===== YOUR KITS WITH NO ARTWORK =====");
  console.log("  (bank chains that hold sounds but have no image folder)");
  console.log("  Create a folder with the name on the left to give it artwork.\n");
  for (const c of unmatched.slice(0, 25)) {
    const n = counts.get(c.id) ?? 0;
    console.log(
      `  image/${c.e1.toLowerCase().padEnd(40)} ${String(n).padStart(5)} sounds` +
        (c.vendor ? `  vendor="${c.vendor}"` : "  (no vendor)"),
    );
  }
  console.log(`\n  ...${Math.max(0, unmatched.length - 25)} more`);

  console.log("\n===== Folders that match NOTHING in the database =====");
  const chainNames = new Set(chains.map((c) => c.e1.toLowerCase()));
  const vendorNames = new Set(chains.filter((c) => c.vendor).map((c) => c.vendor.toLowerCase()));
  const orphans = folders.filter(
    (f) => !chainNames.has(f.toLowerCase()) && !vendorNames.has(f.toLowerCase()),
  );
  console.log(`  ${orphans.length} of ${folders.length}`);
  for (const o of orphans.slice(0, 10)) console.log("    " + o);

  db.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
