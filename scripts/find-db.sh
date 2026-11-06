#!/usr/bin/env bash
# Finds every Maschine/NI browser database on this machine and says which one
# is actually live.
#
#   ./scripts/find-db.sh                   # list them all, newest first
#   ./scripts/find-db.sh "808 COLLECTION"  # and say which ones contain it
#
# Worth running when a library is visible in Maschine's browser but no script
# here can find it: newer NI versions moved the browser database, so the path
# this app defaults to can be a leftover from an older install that stopped
# being written months ago.
#
# Reads only, from copies. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const needle = (process.argv[2] ?? "").trim().toLowerCase();
const roots = [
  path.join(os.homedir(), "Library/Application Support/Native Instruments"),
  "/Users/Shared/Native Instruments",
  "/Library/Application Support/Native Instruments",
];

const found: string[] = [];
const walk = (dir: string, depth: number) => {
  if (depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Sample and preset trees are huge and hold no databases.
      if (/^(Samples?|Presets?|Content|Instruments?|Effects?)$/i.test(e.name)) continue;
      walk(p, depth + 1);
    } else if (/\.(db3|db|sqlite3?)$/i.test(e.name)) {
      found.push(p);
    }
  }
};
for (const r of roots) walk(r, 0);

if (found.length === 0) {
  console.log("No database files found under:");
  for (const r of roots) console.log("  " + r);
  process.exit(0);
}

interface Row { p: string; when: number; size: number; chains: number | null; hit: number | null }
const rows: Row[] = [];

for (const p of found) {
  // Age by the newest of the file and its write-ahead log.
  let when = 0;
  let size = 0;
  for (const ext of ["", "-wal"]) {
    try {
      const st = fs.statSync(p + ext);
      when = Math.max(when, st.mtimeMs);
      if (!ext) size = st.size;
    } catch {}
  }

  let chains: number | null = null;
  let hit: number | null = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-find-"));
  try {
    const copy = path.join(tmp, "s.db3");
    fs.copyFileSync(p, copy);
    for (const ext of ["-wal", "-shm"]) {
      try { fs.copyFileSync(p + ext, copy + ext); } catch {}
    }
    const d = new DatabaseSync(copy);
    try {
      const n = d.prepare("SELECT COUNT(*) AS n FROM k_bank_chain").get();
      chains = Number(n?.n ?? 0);
      if (needle) {
        const r = d
          .prepare(
            "SELECT COUNT(*) AS n FROM k_bank_chain WHERE LOWER(entry1) LIKE ? OR LOWER(entry2) LIKE ?",
          )
          .get(`%${needle}%`, `%${needle}%`);
        hit = Number(r?.n ?? 0);
      }
    } catch {
      // Not a browser database - no k_bank_chain.
    }
    d.close();
  } catch {
    // Locked or unreadable.
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  rows.push({ p, when, size, chains, hit });
}

rows.sort((a, b) => b.when - a.when);

const ago = (ms: number) => {
  const m = (Date.now() - ms) / 60000;
  if (m < 90) return `${Math.round(m)} min ago`;
  if (m < 60 * 48) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
};

console.log(`${rows.length} database file(s), most recently written first\n`);
for (const r of rows) {
  const mb = (r.size / 1048576).toFixed(1);
  console.log(r.p);
  console.log(
    `   written ${ago(r.when)}   ${mb} MB   ` +
      (r.chains === null ? "no k_bank_chain (not a browser database)" : `${r.chains} bank chains`) +
      (r.hit === null ? "" : r.hit > 0 ? `   <-- CONTAINS "${needle}"` : `   (no "${needle}")`),
  );
}

const hits = rows.filter((r) => (r.hit ?? 0) > 0);
if (needle && hits.length > 0) {
  console.log(`\nPoint the tools at the one that has it:\n`);
  console.log(`  export MASCHINE_DB_PATH="${hits[0].p}"`);
  console.log(`  bash scripts/trace-kit.sh "${process.argv[2]}"`);
  console.log(`\nAnd set the same in .env.local so the app reads it too.`);
} else if (needle) {
  console.log(
    `\nNo database holds "${needle}". It is in Maschine's memory and not yet written:`,
  );
  console.log("  quit Maschine completely, then run this again.");
}
NODE
