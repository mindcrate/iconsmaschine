import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { iconmaschineHome } from "./paths";

/**
 * The Types, Characters and bank chains Maschine itself uses.
 *
 * Maschine keeps its browser index in `komplete.db3`. Reading it gives the
 * exact strings in use across every installed library, rather than a
 * hand-copied list. Schema confirmed against a real 354 MB database:
 *
 *   k_category    (id, category, subcategory, subsubcategory)  the Types tree
 *   k_mode        (id, name)                                   the Characters
 *   k_bank_chain  (id, bcvendor, entry1, entry2, entry3)       vendor/product
 *
 * Note `k_sound_info_category` and `k_sound_info_mode` are join tables holding
 * hundreds of thousands of rows - they map sounds to tags and are not the
 * vocabulary.
 *
 * The database belongs to Maschine, so it is opened READ-ONLY and never
 * written. If a read-only open fails (a lock, a WAL in flight), it falls back
 * to reading a temporary copy. Results are cached against the file's size and
 * mtime so a large database is read at most once per change.
 */

export interface BankChain {
  vendor: string;
  entries: string[];
}

export interface TagVocabulary {
  /** Type paths, e.g. ["Brass", "Ensemble"]. */
  types: string[][];
  characters: string[];
  /** Known vendor/product chains, for autocomplete. */
  bankChains: BankChain[];
  vendors: string[];
  source: "database" | "database-copy" | "fallback" | "cache";
  dbPath: string | null;
  note?: string;
}

const FALLBACK_TYPES: string[][] = [
  ["Bass"], ["Bowed Strings"], ["Brass"], ["Drums"], ["Flute"], ["Guitar"],
  ["Mallet Instruments"], ["Organ"], ["Percussion"], ["Piano"],
  ["Plucked Strings"], ["Reed Instruments"], ["Sound Effects"],
  ["Soundscapes"], ["Synth Lead"], ["Synth Misc"], ["Synth Pad"],
  ["Vocal"], ["Other"],
];

const FALLBACK_CHARACTERS = [
  "Acoustic", "Analog", "Bright", "Dark", "Digital", "Dirty", "Distorted",
  "Dry", "Layered", "Processed", "Sample-based", "Synthetic", "Warm", "Wet",
];

function candidateDbPaths(): string[] {
  const mac = path.join(os.homedir(), "Library", "Application Support", "Native Instruments");
  const win = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Native Instruments")
    : "";
  const names = ["Maschine 2", "Komplete Kontrol", "Kontakt 8", "Kontakt 7"];
  const out: string[] = [];
  for (const root of [mac, win]) {
    if (!root) continue;
    for (const n of names) out.push(path.join(root, n, "komplete.db3"));
  }
  return out;
}

function findDb(): string | null {
  const override = process.env.MASCHINE_DB_PATH;
  if (override && fs.existsSync(override)) return override;
  return candidateDbPaths().find((p) => fs.existsSync(p)) ?? null;
}

interface Row {
  [key: string]: unknown;
}
interface Db {
  prepare: (sql: string) => { all: (...args: never[]) => Row[] };
  close: () => void;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function readTypes(db: Db): string[][] {
  const seen = new Set<string>();
  for (const row of db.prepare(
    "SELECT DISTINCT category, subcategory, subsubcategory FROM k_category",
  ).all()) {
    const parts = [row.category, row.subcategory, row.subsubcategory]
      .map(str)
      .filter(Boolean);
    if (parts.length) seen.add(JSON.stringify(parts));
  }
  return [...seen]
    .map((s) => JSON.parse(s) as string[])
    .sort((a, b) => a.join(" > ").localeCompare(b.join(" > ")));
}

function readCharacters(db: Db): string[] {
  const seen = new Set<string>();
  for (const row of db.prepare("SELECT DISTINCT name FROM k_mode").all()) {
    const v = str(row.name);
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function readBankChains(db: Db): BankChain[] {
  const seen = new Map<string, BankChain>();
  for (const row of db.prepare(
    "SELECT DISTINCT bcvendor, entry1, entry2, entry3 FROM k_bank_chain",
  ).all()) {
    const entries = [row.entry1, row.entry2, row.entry3].map(str).filter(Boolean);
    if (entries.length === 0) continue;
    const chain = { vendor: str(row.bcvendor), entries };
    seen.set(JSON.stringify(chain), chain);
  }
  return [...seen.values()].sort((a, b) =>
    (a.vendor + a.entries.join(" ")).localeCompare(b.vendor + b.entries.join(" ")),
  );
}

async function openDb(dbPath: string): Promise<{ db: Db; source: "database" | "database-copy"; cleanup: () => Promise<void> }> {
  const { DatabaseSync } = await import("node:sqlite");

  // Preferred: read-only, in place. No copy, no write possible. The option is
  // accepted at runtime even where the bundled typings omit it.
  try {
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
    } as unknown as undefined) as unknown as Db;
    return { db, source: "database", cleanup: async () => {} };
  } catch {
    // A lock or an in-flight WAL: fall back to reading a snapshot.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "iconmaschine-db-"));
    const copy = path.join(dir, "snapshot.db3");
    await fsp.copyFile(dbPath, copy);
    const db = new DatabaseSync(copy) as unknown as Db;
    return {
      db,
      source: "database-copy",
      cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
    };
  }
}

function cachePath(): string {
  return path.join(iconmaschineHome(), "cache", "tagvocab.json");
}

interface CacheFile {
  key: string;
  value: TagVocabulary;
}

let memo: CacheFile | null = null;

async function cacheKey(dbPath: string): Promise<string> {
  const s = await fsp.stat(dbPath);
  return `${dbPath}:${s.size}:${s.mtimeMs}`;
}

export async function readTagVocabulary(
  opts: { refresh?: boolean } = {},
): Promise<TagVocabulary> {
  const dbPath = findDb();
  if (!dbPath) {
    return {
      types: FALLBACK_TYPES,
      characters: FALLBACK_CHARACTERS,
      bankChains: [],
      vendors: [],
      source: "fallback",
      dbPath: null,
      note: "No Maschine database found; using the built-in tag list.",
    };
  }

  const key = await cacheKey(dbPath);

  if (!opts.refresh) {
    if (memo?.key === key) return { ...memo.value, source: "cache" };
    try {
      const disk = JSON.parse(await fsp.readFile(cachePath(), "utf8")) as CacheFile;
      if (disk.key === key) {
        memo = disk;
        return { ...disk.value, source: "cache" };
      }
    } catch {
      /* no usable cache */
    }
  }

  let cleanup: (() => Promise<void>) | null = null;
  try {
    const opened = await openDb(dbPath);
    cleanup = opened.cleanup;
    try {
      const types = readTypes(opened.db);
      const characters = readCharacters(opened.db);
      const bankChains = readBankChains(opened.db);
      const vendors = [...new Set(bankChains.map((b) => b.vendor).filter(Boolean))].sort();

      const value: TagVocabulary = {
        types: types.length ? types : FALLBACK_TYPES,
        characters: characters.length ? characters : FALLBACK_CHARACTERS,
        bankChains,
        vendors,
        source: opened.source,
        dbPath,
      };

      memo = { key, value };
      try {
        await fsp.mkdir(path.dirname(cachePath()), { recursive: true });
        await fsp.writeFile(cachePath(), JSON.stringify({ key, value }));
      } catch {
        /* caching is an optimisation, not a requirement */
      }
      return value;
    } finally {
      opened.db.close();
    }
  } catch (err) {
    return {
      types: FALLBACK_TYPES,
      characters: FALLBACK_CHARACTERS,
      bankChains: [],
      vendors: [],
      source: "fallback",
      dbPath,
      note: `Could not read ${path.basename(dbPath)} (${(err as Error).message}); using the built-in list.`,
    };
  } finally {
    if (cleanup) await cleanup();
  }
}
