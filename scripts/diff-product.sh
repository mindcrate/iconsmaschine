#!/usr/bin/env bash
# Diffs a WORKING product against a BROKEN one, row for row.
#
#   ./scripts/diff-product.sh voodoo msxii
#
# Shows how each is registered in Maschine's database - bank chain, vendor,
# content path, device type - so the difference between one that shows artwork
# and one that does not is visible rather than guessed at.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [broken = "voodoo", working = "msxii"] = process.argv.slice(2);
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-diff-"));
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
  const q = (sql, ...a) => { try { return d.prepare(sql).all(...a); } catch (e) { return [{ ERROR: e.message }]; } };

  for (const term of [broken, working]) {
    console.log(`\n================ ${term.toUpperCase()} ================`);

    const folderExists = fs.existsSync(path.join(imageDir, term.toLowerCase()));
    console.log(`  image/${term.toLowerCase()}/ exists on disk: ${folderExists}`);

    console.log("\n  -- sounds whose VENDOR matches --");
    for (const r of q(
      `SELECT vendor, COUNT(*) AS n FROM k_sound_info
       WHERE lower(vendor) LIKE ? GROUP BY vendor`, `%${term.toLowerCase()}%`,
    )) console.log("    " + JSON.stringify(r));

    console.log("\n  -- bank chains whose NAME matches --");
    const chains = q(
      `SELECT id, bcvendor, entry1, entry2, entry3 FROM k_bank_chain
       WHERE lower(entry1) LIKE ? OR lower(entry2) LIKE ? OR lower(bcvendor) LIKE ?`,
      `%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`,
    );
    if (chains.length === 0) console.log("    (none)");
    for (const r of chains.slice(0, 8)) console.log("    " + JSON.stringify(r));
    if (chains.length > 8) console.log(`    ... ${chains.length - 8} more`);

    console.log("\n  -- a few of its sounds, in full --");
    const rows = q(
      `SELECT id, name, vendor, bank_chain_id, content_path_id, device_type_flags, file_ext
       FROM k_sound_info WHERE lower(vendor) LIKE ? LIMIT 3`, `%${term.toLowerCase()}%`,
    );
    if (rows.length === 0) console.log("    (no sounds carry that vendor)");
    for (const r of rows) console.log("    " + JSON.stringify(r));

    // How the content is registered on disk.
    const pathIds = [...new Set(rows.map((r) => r.content_path_id).filter((v) => v != null))];
    if (pathIds.length) {
      console.log("\n  -- their content_path rows --");
      for (const id of pathIds) {
        for (const r of q(`SELECT * FROM k_content_path WHERE id = ?`, id)) {
          console.log("    " + JSON.stringify(r).slice(0, 220));
        }
      }
    }

    console.log("\n  -- do its sounds have a bank chain at all? --");
    for (const r of q(
      `SELECT CASE WHEN bank_chain_id IS NULL THEN 'NULL' ELSE 'set' END AS bank_chain,
              COUNT(*) AS n
       FROM k_sound_info WHERE lower(vendor) LIKE ? GROUP BY bank_chain`,
      `%${term.toLowerCase()}%`,
    )) console.log("    " + JSON.stringify(r));
  }

  console.log("\n\n================ k_content_path shape ================");
  for (const r of q("PRAGMA table_info(k_content_path)")) {
    if (!r.ERROR) console.log(`  ${r.name}:${r.type}`);
  }

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
