import fsp from "node:fs/promises";
import path from "node:path";
import { iconmaschineHome } from "./paths";
import {
  findMaschineDb,
  openMaschineDb,
  str as asStr,
  tryAll,
  type MaschineDb,
} from "./maschinedb";

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
  /**
   * The same lists ordered by how many WAV files use each name, most first.
   * Vendors spell some types two ways ("Hi-Hat Closed", "Hihat Closed") and
   * Maschine filters them apart, so the common spelling should come first.
   */
  sampleTypes: string[][];
  sampleCharacters: string[];
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

type Db = MaschineDb;
const str = asStr;

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

const WAV_TYPE_USE = `SELECT c.category AS a, c.subcategory AS b, c.subsubcategory AS c, count(*) AS n
  FROM k_sound_info s
  JOIN k_sound_info_category sc ON sc.sound_info_id = s.id
  JOIN k_category c ON c.id = sc.category_id
  WHERE lower(s.file_ext) = 'wav' GROUP BY c.id`;

const WAV_MODE_USE = `SELECT m.name AS a, count(*) AS n
  FROM k_sound_info s
  JOIN k_sound_info_mode sm ON sm.sound_info_id = s.id
  JOIN k_mode m ON m.id = sm.mode_id
  WHERE lower(s.file_ext) = 'wav' GROUP BY m.id`;

/** Use counts keyed as the vocabulary keys them. Missing tables count as no use. */
function usage(db: Db, sql: string, key: (row: Record<string, unknown>) => string): Map<string, number> {
  const used = new Map<string, number>();
  for (const row of tryAll(db, sql)) {
    const k = key(row);
    used.set(k, (used.get(k) ?? 0) + Number(row.n));
  }
  return used;
}

/** Most-used first; the sort is stable, so ties keep the alphabetical order. */
function byUse<T>(items: T[], key: (t: T) => string, used: Map<string, number>): T[] {
  return [...items].sort((x, y) => (used.get(key(y)) ?? 0) - (used.get(key(x)) ?? 0));
}

const typeKey = (parts: string[]) => JSON.stringify(parts);

function readSampleOrder(db: Db, types: string[][], characters: string[]) {
  const typeUse = usage(db, WAV_TYPE_USE, (r) => typeKey([r.a, r.b, r.c].map(str).filter(Boolean)));
  const modeUse = usage(db, WAV_MODE_USE, (r) => str(r.a));
  return {
    sampleTypes: byUse(types, typeKey, typeUse),
    sampleCharacters: byUse(characters, (c) => c, modeUse),
  };
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
  return `v2:${dbPath}:${s.size}:${s.mtimeMs}`;
}

export async function readTagVocabulary(
  opts: { refresh?: boolean } = {},
): Promise<TagVocabulary> {
  const dbPath = findMaschineDb();
  if (!dbPath) {
    return {
      types: FALLBACK_TYPES,
      characters: FALLBACK_CHARACTERS,
      sampleTypes: FALLBACK_TYPES,
      sampleCharacters: FALLBACK_CHARACTERS,
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
    const opened = await openMaschineDb(dbPath);
    cleanup = opened.cleanup;
    try {
      const types = readTypes(opened.db);
      const characters = readCharacters(opened.db);
      const bankChains = readBankChains(opened.db);
      const vendors = [...new Set(bankChains.map((b) => b.vendor).filter(Boolean))].sort();

      const finalTypes = types.length ? types : FALLBACK_TYPES;
      const finalCharacters = characters.length ? characters : FALLBACK_CHARACTERS;
      const value: TagVocabulary = {
        types: finalTypes,
        characters: finalCharacters,
        ...readSampleOrder(opened.db, finalTypes, finalCharacters),
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
      sampleTypes: FALLBACK_TYPES,
      sampleCharacters: FALLBACK_CHARACTERS,
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
