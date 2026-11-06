#!/usr/bin/env bash
# Works out how Maschine classifies content: Group vs Sound vs Loop vs
# One-shot vs Instrument vs Effect.
#
# Needed to split the kit picker into Groups and Samples, and to make the
# preset tag lists context-relevant instead of showing instruments and effects
# everywhere.
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-types-"));
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
  const q = (sql) => { try { return d.prepare(sql).all(); } catch (e) { return [{ ERROR: e.message }]; } };

  console.log("===== device_type_flags: what values exist, and how many sounds each =====");
  for (const r of q(
    "SELECT device_type_flags AS flags, COUNT(*) AS n FROM k_sound_info GROUP BY device_type_flags ORDER BY n DESC LIMIT 20",
  )) console.log("  " + JSON.stringify(r));

  console.log("\n===== file_ext by device_type_flags (what each flag actually IS) =====");
  for (const r of q(
    `SELECT device_type_flags AS flags, file_ext, COUNT(*) AS n
     FROM k_sound_info GROUP BY device_type_flags, file_ext ORDER BY n DESC LIMIT 25`,
  )) console.log("  " + JSON.stringify(r));

  console.log("\n===== the per-type tables: are they content, or search indexes? =====");
  for (const t of ["p_sound_info_Group_1", "p_sound_info_Loop_1", "p_sound_info_Oneshot_1",
                   "p_sound_info_Instrument_1", "p_sound_info_Effect_1", "p_sound_info_Sound_1"]) {
    const cols = q(`PRAGMA table_info("${t}")`);
    const countRow = q(`SELECT COUNT(*) AS n FROM "${t}"`)[0];
    if (cols.length === 0 || cols[0]?.ERROR || countRow?.ERROR) {
      console.log(`  ${t}: (not present on this machine)`);
      continue;
    }
    const n = countRow?.n;
    console.log(`\n  --- ${t} --- ${n} rows`);
    console.log("    columns: " + cols.map((c) => `${c.name}:${c.type}`).join(", "));
    for (const row of q(`SELECT * FROM "${t}" LIMIT 3`)) {
      console.log("      " + JSON.stringify(row).slice(0, 160));
    }
  }

  console.log("\n===== content type per bank chain (the question that matters) =====");
  console.log("  For each kit with no artwork, what KIND of content is it?\n");
  const rows = q(`
    SELECT bc.entry1 AS name, si.device_type_flags AS flags, si.file_ext AS ext, COUNT(*) AS n
    FROM k_sound_info si
    JOIN k_bank_chain bc ON bc.id = si.bank_chain_id
    WHERE bc.entry1 IS NOT NULL AND bc.entry1 NOT LIKE '/%'
    GROUP BY bc.entry1, si.device_type_flags, si.file_ext
    ORDER BY n DESC LIMIT 30`);
  for (const r of rows) {
    console.log(`  ${String(r.name).padEnd(34)} flags=${String(r.flags).padEnd(6)} ext=${String(r.ext).padEnd(8)} ${r.n}`);
  }

  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\n===== Done - nothing was modified =====");
NODE
