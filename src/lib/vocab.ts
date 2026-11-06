import fs from "node:fs/promises";
import path from "node:path";
import { niDistDatabaseDir } from "./paths";
import {
  findMaschineDb,
  openMaschineDb,
  str,
  tryAll,
  type MaschineDb,
} from "./maschinedb";
import { effectiveVendor } from "./kits";
import { classify } from "./contenttype";
import { validateFolderName } from "./spec";
import suggestionFile from "../data/vendor-suggestions.json" with { type: "json" };

/**
 * Maschine accepts a controlled vocabulary of FileType and Category strings.
 * Rather than hardcode a guess, read the real values out of the
 * `dist_database` entries already installed on this machine - the same
 * principle that corrected the image sizes.
 *
 * The fallback below is only used when nothing is installed yet.
 */

export interface Vocabulary {
  /** FileType -> categories seen with it, most common first. */
  byFileType: Record<string, string[]>;
  /** Vendors Maschine itself records, spelled as it records them. Sorted A-Z, case-insensitive. */
  vendors: string[];
  /** Unverified spellings from src/data/vendor-suggestions.json, minus any already in `vendors` (case-insensitive). Sorted A-Z, case-insensitive. */
  suggestedVendors: string[];
  /** True when read from installed entries rather than the fallback. */
  fromDisk: boolean;
  scanned: number;
}

const FALLBACK: Record<string, string[]> = {
  Instruments: [
    "Bass",
    "Bowed Strings",
    "Brass",
    "Drums",
    "Flute",
    "Guitar",
    "Mallet Instruments",
    "Organ",
    "Percussion",
    "Piano / Keys",
    "Plucked Strings",
    "Reed Instruments",
    "Sampled Instruments",
    "Soundscapes",
    "Synthesizers",
    "Vocal",
    "Other",
  ],
  Effects: [
    "Amps and Cabinets",
    "Character",
    "Chorus",
    "Compressor",
    "Delay",
    "Distortion",
    "EQ",
    "Filter",
    "Flanger",
    "Imaging",
    "Limiter",
    "Modulation",
    "Phaser",
    "Pitch",
    "Reverb",
    "Soundfield",
    "Tool",
    "Other",
  ],
};

interface CategoriesFile {
  Vendor?: string;
  Product?: string;
  CategoryDB?: { FileType?: string; Categories?: string[] }[];
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();
const key = (v: string) => v.toLowerCase();
const byName = (a: string, b: string) =>
  key(a).localeCompare(key(b)) || a.localeCompare(b);

/**
 * `known` is in priority order: the first spelling seen per case-insensitive
 * key wins. Suggestions never repeat a known name, and any the folder-name
 * check would reject are dropped, since the field would reject them too.
 */
export function mergeVendors(
  known: string[],
  suggestions: string[],
): { vendors: string[]; suggestedVendors: string[] } {
  const seen = new Set<string>();
  const vendors: string[] = [];
  for (const raw of known) {
    const v = clean(raw);
    if (!v || seen.has(key(v))) continue;
    seen.add(key(v));
    vendors.push(v);
  }
  const suggestedVendors: string[] = [];
  for (const raw of suggestions) {
    const v = clean(raw);
    if (!v || seen.has(key(v)) || validateFolderName(v)) continue;
    seen.add(key(v));
    suggestedVendors.push(v);
  }
  return {
    vendors: vendors.sort(byName),
    suggestedVendors: suggestedVendors.sort(byName),
  };
}

/**
 * A plain AU/VST plugin has no vendor on its sounds or its bank chain, and
 * Maschine groups it under the bank chain's first entry, which is the maker's
 * own name ("Valhalla DSP, LLC", "iZotope, Inc."). Sample packs without a
 * vendor use the same column for the pack's name, so only headings holding
 * instruments or effects count. The heading is judged as a whole: "Kontakt"
 * and "Reaktor" have a few vendor-less chains among many Native Instruments
 * ones, and are products, not makers.
 */
function pluginMakerNames(db: MaschineDb): Map<string, number> {
  const headings = new Map<string, { vendored: boolean; plugins: number }>();
  for (const r of tryAll(
    db,
    `SELECT c.entry1 AS name, c.bcvendor AS bcv, s.vendor AS sv,
            s.device_type_flags AS flags, s.file_ext AS ext, COUNT(*) AS n
     FROM k_sound_info s JOIN k_bank_chain c ON c.id = s.bank_chain_id
     GROUP BY c.entry1, c.bcvendor, s.vendor, s.device_type_flags, s.file_ext`,
  )) {
    const name = clean(str(r.name));
    if (!name || name.startsWith("/")) continue;
    const h = headings.get(name) ?? { vendored: false, plugins: 0 };
    if (effectiveVendor(str(r.bcv)) || effectiveVendor(str(r.sv))) h.vendored = true;
    const type = classify(Number(r.flags ?? 0), str(r.ext));
    if (type === "instrument" || type === "effect") h.plugins += Number(r.n ?? 0);
    headings.set(name, h);
  }
  const names = new Map<string, number>();
  for (const [name, { vendored, plugins }] of headings) {
    if (!vendored && plugins > 0) names.set(name, plugins);
  }
  return names;
}

/** Vendor names in Maschine's own database, commonest spelling first. */
async function readDbVendors(): Promise<string[]> {
  const dbPath = findMaschineDb();
  if (!dbPath) return [];
  try {
    const opened = await openMaschineDb(dbPath);
    try {
      const counts = new Map<string, number>();
      const add = (sql: string, col: string) => {
        for (const r of tryAll(opened.db, sql)) {
          const v = clean(str(r[col]));
          if (!v || !effectiveVendor(v)) continue;
          counts.set(v, (counts.get(v) ?? 0) + Number(r.n ?? 0));
        }
      };
      add(
        "SELECT vendor AS v, COUNT(*) AS n FROM k_sound_info WHERE vendor IS NOT NULL GROUP BY vendor",
        "v",
      );
      add(
        "SELECT bcvendor AS v, COUNT(*) AS n FROM k_bank_chain WHERE bcvendor IS NOT NULL GROUP BY bcvendor",
        "v",
      );
      for (const [name, n] of pluginMakerNames(opened.db)) {
        counts.set(name, (counts.get(name) ?? 0) + n);
      }
      return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name);
    } finally {
      await opened.cleanup().catch(() => {});
      try {
        opened.db.close();
      } catch {
        /* already closed */
      }
    }
  } catch {
    return [];
  }
}

export async function readVocabulary(): Promise<Vocabulary> {
  const root = niDistDatabaseDir();
  const counts = new Map<string, Map<string, number>>();
  const vendors = new Set<string>();
  let scanned = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.name === "categories.json") {
        try {
          // utf-8 BOMs show up in some of these files.
          const raw = (await fs.readFile(full, "utf8")).replace(/^﻿/, "");
          const parsed = JSON.parse(raw) as CategoriesFile;
          scanned++;
          if (parsed.Vendor) vendors.add(parsed.Vendor);
          for (const block of parsed.CategoryDB ?? []) {
            const ft = block.FileType;
            if (!ft) continue;
            const bucket = counts.get(ft) ?? new Map<string, number>();
            for (const cat of block.Categories ?? []) {
              bucket.set(cat, (bucket.get(cat) ?? 0) + 1);
            }
            counts.set(ft, bucket);
          }
        } catch {
          /* a single unreadable file should not sink the scan */
        }
      }
    }
  };

  await walk(root, 0);

  const merged = mergeVendors(
    [...vendors, ...(await readDbVendors())],
    suggestionFile.vendors,
  );

  if (scanned === 0) {
    return {
      byFileType: FALLBACK,
      ...merged,
      fromDisk: false,
      scanned: 0,
    };
  }

  const byFileType: Record<string, string[]> = {};
  for (const [ft, bucket] of counts) {
    byFileType[ft] = [...bucket.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }

  return {
    byFileType,
    ...merged,
    fromDisk: true,
    scanned,
  };
}
