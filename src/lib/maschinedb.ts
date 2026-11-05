import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Opening Maschine's browser database.
 *
 * It belongs to Maschine, so it is opened READ-ONLY in place - the option is
 * accepted at runtime even where the bundled typings omit it. If that fails (a
 * lock, an in-flight WAL) it falls back to reading a temporary copy. Either
 * way nothing is ever written: the database is Maschine's to manage.
 */

export interface Row {
  [key: string]: unknown;
}

export interface MaschineDb {
  prepare: (sql: string) => { all: (...args: never[]) => Row[] };
  close: () => void;
}

export function findMaschineDb(): string | null {
  const override = process.env.MASCHINE_DB_PATH;
  if (override && fs.existsSync(override)) return override;

  const mac = path.join(os.homedir(), "Library", "Application Support", "Native Instruments");
  const win = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Native Instruments")
    : "";
  const names = ["Maschine 2", "Komplete Kontrol", "Kontakt 8", "Kontakt 7"];

  for (const root of [mac, win]) {
    if (!root) continue;
    for (const n of names) {
      const p = path.join(root, n, "komplete.db3");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export interface OpenedDb {
  db: MaschineDb;
  source: "database" | "database-copy";
  cleanup: () => Promise<void>;
}

export async function openMaschineDb(dbPath: string): Promise<OpenedDb> {
  const { DatabaseSync } = await import("node:sqlite");

  try {
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
    } as unknown as undefined) as unknown as MaschineDb;
    return { db, source: "database", cleanup: async () => {} };
  } catch {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "iconmaschine-db-"));
    const copy = path.join(dir, "snapshot.db3");
    await fsp.copyFile(dbPath, copy);
    const db = new DatabaseSync(copy) as unknown as MaschineDb;
    return {
      db,
      source: "database-copy",
      cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
    };
  }
}

/** Runs a query, returning [] rather than throwing on a schema mismatch. */
export function tryAll(db: MaschineDb, sql: string): Row[] {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
