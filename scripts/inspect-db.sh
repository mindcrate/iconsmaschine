#!/usr/bin/env bash
# Read-only peek at Maschine's browser database, to confirm which tables the
# tag-vocabulary reader should query.
#
# It copies the database to a temp file and inspects the copy, so Maschine's
# own file is never opened, locked or modified. Uses Node's built-in SQLite,
# so nothing extra needs installing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const candidates = [
  process.env.MASCHINE_DB_PATH,
  path.join(os.homedir(), "Library", "Application Support", "Native Instruments", "Maschine 3", "komplete.db3"),
].filter(Boolean);

const db = candidates.find((p) => p && fs.existsSync(p));
if (!db) {
  console.log("No komplete.db3 found. Pass one: MASCHINE_DB_PATH=/path/to/komplete.db3 ./scripts/inspect-db.sh");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-db-"));
const copy = path.join(dir, "snapshot.db3");
fs.copyFileSync(db, copy);

try {
  console.log("===== Database =====");
  console.log(db);
  console.log(`  ${(fs.statSync(db).size / 1e6).toFixed(1)} MB  (reading a copy; original untouched)`);

  const d = new DatabaseSync(copy);
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);

  console.log(`\n===== All ${tables.length} tables =====`);
  console.log("  " + tables.join("\n  "));

  const interesting = tables.filter((t) => /categor|mode|type|charact|tag|bank|vendor/i.test(t));
  console.log(`\n===== ${interesting.length} tag-related tables =====`);
  for (const t of interesting) {
    console.log(`\n--- ${t} ---`);
    try {
      const cols = d.prepare(`PRAGMA table_info("${t}")`).all().map((c) => `${c.name}:${c.type}`);
      console.log("    columns: " + cols.join(", "));
      const n = d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).all()[0].n;
      console.log(`    rows: ${n}`);
      for (const row of d.prepare(`SELECT * FROM "${t}" LIMIT 5`).all()) {
        console.log("      " + JSON.stringify(row));
      }
    } catch (e) {
      console.log("    (unreadable: " + e.message + ")");
    }
  }
  d.close();
  console.log("\n===== Done - the original database was not opened or modified =====");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
NODE
