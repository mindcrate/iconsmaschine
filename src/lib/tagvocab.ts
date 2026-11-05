import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The Types and Characters vocabulary Maschine itself uses.
 *
 * Maschine keeps its browser index in a SQLite database. Reading it gives the
 * exact tag strings in use across every installed library - far better than a
 * hand-copied list.
 *
 * The database belongs to Maschine, so it is never opened in place: we copy it
 * to a temp file, read the copy, and delete it. That rules out taking a lock
 * on a database Maschine may have open, and makes an accidental write
 * impossible.
 *
 * If it cannot be read (Maschine holding a lock, a schema change, SQLite
 * unavailable), the curated fallback below is used instead.
 */

export interface TagVocabulary {
  /** Type paths, e.g. ["Drums", "Kick"]. */
  types: string[][];
  characters: string[];
  source: "database" | "fallback";
  dbPath: string | null;
  note?: string;
}

/** NI's documented tag set, used when the database cannot be read. */
const FALLBACK_TYPES: string[][] = [
  ["Bass"], ["Bass", "Analog Bass"], ["Bass", "Acoustic Bass"], ["Bass", "Sub Bass"],
  ["Bass", "Synth Bass"],
  ["Bowed Strings"], ["Bowed Strings", "Cello"], ["Bowed Strings", "Violin"],
  ["Brass"], ["Brass", "Horn"], ["Brass", "Synth Brass"], ["Brass", "Trumpet"],
  ["Drums"], ["Drums", "Beatbox"], ["Drums", "Kick"], ["Drums", "Snare"],
  ["Drums", "Hihat"], ["Drums", "Clap"], ["Drums", "Cymbal"], ["Drums", "Tom"],
  ["Drums", "Drumset"],
  ["Flute"], ["Guitar"], ["Guitar", "Acoustic Guitar"], ["Guitar", "Electric Guitar"],
  ["Mallet Instruments"], ["Organ"], ["Percussion"], ["Piano"],
  ["Piano", "Acoustic Piano"], ["Piano", "Electric Piano"],
  ["Plucked Strings"], ["Reed Instruments"],
  ["Sound Effects"], ["Soundscapes"],
  ["Synth Lead"], ["Synth Misc"], ["Synth Pad"],
  ["Vocal"], ["Other"],
];

const FALLBACK_CHARACTERS = [
  "Acoustic", "Additive", "Aggressive", "Analog", "Arpeggiated", "Big",
  "Bright", "Clean", "Cold", "Dark", "Decaying", "Deep", "Digital",
  "Dirty", "Dissonant", "Distorted", "Dry", "Electric", "Ethereal", "Evolving",
  "FM", "Glide", "Granular", "Hard", "Harmonic", "Layered", "Metallic",
  "Muted", "Natural", "Noisy", "Percussive", "Processed",
  "Resonant", "Reverberant", "Sequence/Loop", "Simple", "Soft", "Stereo",
  "Sustained", "Synthetic", "Tempo-synced", "Warm", "Wet",
];

function candidateDbPaths(): string[] {
  const base = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Native Instruments",
  );
  const winBase = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Native Instruments",
  );
  const names = ["Maschine 2", "Komplete Kontrol", "Kontakt 8", "Kontakt 7"];
  const out: string[] = [];
  for (const root of [base, winBase]) {
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

/**
 * Opens the database read-only and pulls out the distinct tag strings.
 *
 * The schema is not documented, so this probes the tables that exist rather
 * than assuming. Anything unexpected falls back rather than throwing.
 */
export async function readTagVocabulary(): Promise<TagVocabulary> {
  const dbPath = findDb();
  if (!dbPath) {
    return {
      types: FALLBACK_TYPES,
      characters: FALLBACK_CHARACTERS,
      source: "fallback",
      dbPath: null,
      note: "No Maschine database found; using the built-in tag list.",
    };
  }

  // Guard against copying a huge database just to read a tag list.
  const MAX_BYTES = 600 * 1024 * 1024;
  let copyPath: string | null = null;

  try {
    const { size } = await fsp.stat(dbPath);
    if (size > MAX_BYTES) {
      return {
        types: FALLBACK_TYPES,
        characters: FALLBACK_CHARACTERS,
        source: "fallback",
        dbPath,
        note: `${path.basename(dbPath)} is ${(size / 1e6).toFixed(0)} MB - too large to copy for a tag read.`,
      };
    }

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "iconmaschine-db-"));
    copyPath = path.join(dir, "snapshot.db3");
    await fsp.copyFile(dbPath, copyPath);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(copyPath) as unknown as Db;
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => String((r as { name: unknown }).name));

      const types = collectTypes(db, tables);
      const characters = collectCharacters(db, tables);

      if (types.length === 0 && characters.length === 0) {
        return {
          types: FALLBACK_TYPES,
          characters: FALLBACK_CHARACTERS,
          source: "fallback",
          dbPath,
          note: `Read ${path.basename(dbPath)} but found no recognisable tag tables (saw: ${tables.slice(0, 8).join(", ")}).`,
        };
      }

      return {
        types: types.length ? types : FALLBACK_TYPES,
        characters: characters.length ? characters : FALLBACK_CHARACTERS,
        source: "database",
        dbPath,
      };
    } finally {
      (db as unknown as { close: () => void }).close();
    }
  } catch (err) {
    return {
      types: FALLBACK_TYPES,
      characters: FALLBACK_CHARACTERS,
      source: "fallback",
      dbPath,
      note: `Could not read ${path.basename(dbPath)} (${(err as Error).message}); using the built-in list.`,
    };
  } finally {
    if (copyPath) {
      await fsp.rm(path.dirname(copyPath), { recursive: true, force: true });
    }
  }
}

type Db = {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] };
};

/** NI has used a few schemas; try the known shapes and keep what works. */
function collectTypes(db: Db, tables: string[]): string[][] {
  const out = new Set<string>();

  if (tables.includes("k_sound_info_category")) {
    tryQuery(db, "SELECT DISTINCT category, subcategory, subsubcategory FROM k_sound_info_category", (row) => {
      const r = row as Record<string, unknown>;
      const parts = [r.category, r.subcategory, r.subsubcategory]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
      if (parts.length) out.add(JSON.stringify(parts));
    });
  }
  for (const t of ["k_category", "category"]) {
    if (!tables.includes(t)) continue;
    tryQuery(db, `SELECT DISTINCT category, subcategory, subsubcategory FROM ${t}`, (row) => {
      const r = row as Record<string, unknown>;
      const parts = [r.category, r.subcategory, r.subsubcategory]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
      if (parts.length) out.add(JSON.stringify(parts));
    });
  }

  return [...out]
    .map((s) => JSON.parse(s) as string[])
    .sort((a, b) => a.join(" > ").localeCompare(b.join(" > ")));
}

function collectCharacters(db: Db, tables: string[]): string[] {
  const out = new Set<string>();
  for (const t of ["k_mode", "mode", "k_sound_info_mode"]) {
    if (!tables.includes(t)) continue;
    tryQuery(db, `SELECT DISTINCT name FROM ${t}`, (row) => {
      const v = (row as { name?: unknown }).name;
      if (typeof v === "string" && v.trim()) out.add(v.trim());
    });
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function tryQuery(db: Db, sql: string, onRow: (row: unknown) => void): void {
  try {
    for (const row of db.prepare(sql).all()) onRow(row);
  } catch {
    /* a schema that does not match is expected; other shapes are tried */
  }
}
