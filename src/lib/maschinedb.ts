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

/**
 * The browser database Maschine is actually writing.
 *
 * This used to try a fixed list with "Maschine 2" at the front and return the
 * first that existed. On a machine running Maschine 3 that is the wrong file:
 * both exist, the Maschine 2 one is bigger and has more bank chains, and it
 * stopped being written when Maschine 3 took over. Every reading taken from it
 * was a snapshot of an abandoned install, which is not a mistake that
 * announces itself - the data looks perfectly reasonable, just stale.
 *
 * So pick by what is live rather than by name: enumerate the candidates and
 * take the most recently written, counting the -wal, since that is where
 * recent changes sit until a checkpoint. No version list to keep up to date.
 */
export function findMaschineDb(): string | null {
  const override = process.env.MASCHINE_DB_PATH;
  if (override && fs.existsSync(override)) return override;

  const roots = [
    path.join(os.homedir(), "Library", "Application Support", "Native Instruments"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Native Instruments")
      : "",
  ].filter(Boolean);

  let best: { path: string; when: number } | null = null;
  for (const root of roots) {
    let apps: string[];
    try {
      apps = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const app of apps) {
      const p = path.join(root, app, "komplete.db3");
      let when = 0;
      for (const ext of ["", "-wal"]) {
        try {
          when = Math.max(when, fs.statSync(p + ext).mtimeMs);
        } catch {
          if (!ext) break; // no database here at all
        }
      }
      if (when > 0 && (!best || when > best.when)) best = { path: p, when };
    }
  }
  return best?.path ?? null;
}

export interface OpenedDb {
  db: MaschineDb;
  source: "database" | "database-copy";
  cleanup: () => Promise<void>;
}

/**
 * Copies a database to a scratch directory, sidecars included.
 *
 * SQLite in WAL mode keeps recent writes in a `-wal` file and only folds them
 * into the main one at a checkpoint, which Maschine does when it quits. A copy
 * of the `.db3` alone is therefore whatever was true at the last checkpoint -
 * on one machine that was two days stale, which silently made every reading
 * taken from it out of date. Bringing the sidecars lets SQLite replay the log.
 */
export async function snapshotDatabase(
  dbPath: string,
): Promise<{ dir: string; copy: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "iconmaschine-db-"));
  const copy = path.join(dir, "snapshot.db3");
  await fsp.copyFile(dbPath, copy);
  for (const ext of ["-wal", "-shm"]) {
    await fsp.copyFile(dbPath + ext, copy + ext).catch(() => {});
  }
  return { dir, copy };
}

export async function openMaschineDb(dbPath: string): Promise<OpenedDb> {
  const { DatabaseSync } = await import("node:sqlite");

  try {
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
    } as unknown as undefined) as unknown as MaschineDb;
    return { db, source: "database", cleanup: async () => {} };
  } catch {
    const { dir, copy } = await snapshotDatabase(dbPath);
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
