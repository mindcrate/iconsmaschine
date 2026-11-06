#!/usr/bin/env bash
# Everything about one or more bank chains, by id.
#
#   ./scripts/inspect-chain.sh 1391 1392
#
# Shows the chain row, how many sounds sit on it, what vendor those SOUNDS
# carry (which can differ from the chain's own bcvendor), and where they live
# on disk. Use it when a product is registered but its artwork will not
# resolve.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (ids.length === 0) { console.log("Usage: ./scripts/inspect-chain.sh <id> [id...]"); process.exit(0); }

const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? "/Users/Shared/NI Resources/image";
const dbPath =
  process.env.MASCHINE_DB_PATH ??
  path.join(os.homedir(), "Library/Application Support/Native Instruments/Maschine 2/komplete.db3");
if (!fs.existsSync(dbPath)) { console.log("No komplete.db3 at " + dbPath); process.exit(0); }

const folders = new Set(
  (fs.existsSync(imageDir) ? fs.readdirSync(imageDir, { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-chain-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);

try {
  const d = new DatabaseSync(copy);
  // Timestamps in this schema overflow a JS number, so never SELECT *.
  const q = (sql, ...a) => { try { return d.prepare(sql).all(...a); } catch (e) { return [{ ERROR: e.message }]; } };

  for (const id of ids) {
    console.log(`\n================ bank chain ${id} ================`);
    for (const r of q("SELECT id, bcvendor, entry1, entry2, entry3 FROM k_bank_chain WHERE id = ?", id)) {
      console.log("  chain: " + JSON.stringify(r));
      const v = String(r.bcvendor ?? "").trim();
      const n = String(r.entry1 ?? "").trim();
      console.log(`  image/${v.toLowerCase()}/ exists: ${v ? folders.has(v.toLowerCase()) : "(no vendor)"}`);
      console.log(`  image/${n.toLowerCase()}/ exists: ${folders.has(n.toLowerCase())}`);
    }

    const total = q("SELECT COUNT(*) AS n FROM k_sound_info WHERE bank_chain_id = ?", id)[0]?.n;
    console.log(`\n  sounds on this chain: ${total}`);

    console.log("\n  -- what vendor do those SOUNDS carry? --");
    for (const r of q(
      `SELECT vendor, COUNT(*) AS n FROM k_sound_info WHERE bank_chain_id = ?
       GROUP BY vendor ORDER BY n DESC LIMIT 8`, id,
    )) console.log("    " + JSON.stringify(r));

    console.log("\n  -- content type --");
    for (const r of q(
      `SELECT device_type_flags AS flags, file_ext AS ext, COUNT(*) AS n
       FROM k_sound_info WHERE bank_chain_id = ? GROUP BY flags, ext ORDER BY n DESC LIMIT 5`, id,
    )) console.log("    " + JSON.stringify(r));

    console.log("\n  -- where they live on disk --");
    for (const r of q(
      `SELECT DISTINCT cp.id AS id, cp.path AS path, cp.alias AS alias,
              cp.content_type AS content_type, cp.visible AS visible
       FROM k_sound_info si JOIN k_content_path cp ON cp.id = si.content_path_id
       WHERE si.bank_chain_id = ? LIMIT 4`, id,
    )) console.log("    " + JSON.stringify(r).slice(0, 240));

    console.log("\n  -- three example sounds --");
    for (const r of q(
      `SELECT id, name, vendor, file_ext FROM k_sound_info WHERE bank_chain_id = ? LIMIT 3`, id,
    )) console.log("    " + JSON.stringify(r));
  }

  console.log("\n\n================ for comparison: a WORKING chain ================");
  for (const r of q(
    `SELECT id, bcvendor, entry1 FROM k_bank_chain WHERE lower(bcvendor) = 'msxii' LIMIT 1`,
  )) {
    console.log("  " + JSON.stringify(r));
    for (const v of q(
      `SELECT vendor, COUNT(*) AS n FROM k_sound_info WHERE bank_chain_id = ? GROUP BY vendor`, r.id,
    )) console.log("    sound vendor: " + JSON.stringify(v));
    for (const p of q(
      `SELECT DISTINCT cp.path AS path, cp.content_type AS content_type, cp.visible AS visible
       FROM k_sound_info si JOIN k_content_path cp ON cp.id = si.content_path_id
       WHERE si.bank_chain_id = ? LIMIT 2`, r.id,
    )) console.log("    content path: " + JSON.stringify(p).slice(0, 220));
  }

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
