import fs from "node:fs/promises";
import path from "node:path";
import { niDistDatabaseDir } from "./paths";

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
  vendors: string[];
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

  if (scanned === 0) {
    return {
      byFileType: FALLBACK,
      vendors: [],
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
    vendors: [...vendors].sort(),
    fromDisk: true,
    scanned,
  };
}
