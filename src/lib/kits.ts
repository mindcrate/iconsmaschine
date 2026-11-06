import fs from "node:fs/promises";
import { findMaschineDb, openMaschineDb, str, tryAll } from "./maschinedb";
import { niImageDir } from "./paths";
import { folderName } from "./distdb";
import {
  classify,
  emptyCounts,
  groupsPresent,
  type ContentCounts,
  type ContentGroup,
} from "./contenttype";

/**
 * Your Maschine kits, and which of them have no artwork.
 *
 * Content with no vendor - Expansions, user kits - resolves its browser
 * artwork from `NI Resources/image/<bank chain entry1>/`, lowercased.
 * Established by correlation on a real system: every Group showing the generic
 * plug icon in the browser was exactly a bank chain with no matching image
 * folder, and every Group showing artwork had one.
 *
 * Content WITH a vendor follows the plugin path instead
 * (`image/<vendor>/<product>/` plus a dist_database entry).
 */

export interface Kit {
  /** The bank chain's first entry - what names the image folder. */
  name: string;
  /** Second entry, where there is one. Shown for context only. */
  sub: string;
  vendor: string;
  sounds: number;
  /** Folder this kit's artwork would live in, relative to image/. */
  folder: string;
  hasArtwork: boolean;
  /** What the kit actually holds, by content type. */
  counts: ContentCounts;
  /** The UI groupings it has content for, largest first. */
  groups: ContentGroup[];
}

export interface KitScan {
  kits: Kit[];
  imageDir: string;
  dbPath: string | null;
  note?: string;
}

/**
 * "Other" is Maschine's catch-all, not a real vendor, so it is treated as
 * vendor-less for artwork purposes.
 */
function effectiveVendor(v: string): string {
  return v.toLowerCase() === "other" ? "" : v;
}

export async function scanKits(): Promise<KitScan> {
  const imageDir = niImageDir();
  const dbPath = findMaschineDb();

  if (!dbPath) {
    return {
      kits: [],
      imageDir,
      dbPath: null,
      note: "No Maschine database found, so your kits could not be listed.",
    };
  }

  let folders: Set<string>;
  try {
    const entries = await fs.readdir(imageDir, { withFileTypes: true });
    folders = new Set(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name.toLowerCase()),
    );
  } catch {
    folders = new Set();
  }

  let cleanup: (() => Promise<void>) | null = null;
  try {
    const opened = await openMaschineDb(dbPath);
    cleanup = opened.cleanup;
    try {
      // Per chain, a breakdown by content type - a kit can hold several at
      // once (INSTRUMENT SAMPLE LIBRARIES has 8,244 one-shots AND 5,949 loops),
      // so one label per kit would be wrong.
      const byChain = new Map<number, ContentCounts>();
      for (const r of tryAll(
        opened.db,
        `SELECT bank_chain_id AS id, device_type_flags AS flags, file_ext AS ext,
                COUNT(*) AS n
         FROM k_sound_info
         GROUP BY bank_chain_id, device_type_flags, file_ext`,
      )) {
        const id = Number(r.id);
        const counts = byChain.get(id) ?? emptyCounts();
        counts[classify(Number(r.flags ?? 0), str(r.ext))] += Number(r.n ?? 0);
        byChain.set(id, counts);
      }

      const total = (c: ContentCounts) =>
        Object.values(c).reduce((a, b) => a + b, 0);

      // Several chain rows can share a name (different sub-banks), so collapse
      // them: one kit per folder, with the counts added up.
      const byFolder = new Map<string, Kit>();

      for (const r of tryAll(
        opened.db,
        "SELECT id, bcvendor, entry1, entry2 FROM k_bank_chain",
      )) {
        const name = str(r.entry1);
        // Some rows hold an absolute path rather than a name - not a kit.
        if (!name || name.startsWith("/")) continue;

        const vendor = effectiveVendor(str(r.bcvendor));
        const counts = byChain.get(Number(r.id));
        if (!counts) continue;
        const sounds = total(counts);
        if (sounds === 0) continue;

        const folder = folderName(name);
        const existing = byFolder.get(folder);
        if (existing) {
          existing.sounds += sounds;
          for (const k of Object.keys(counts) as (keyof ContentCounts)[]) {
            existing.counts[k] += counts[k];
          }
          existing.groups = groupsPresent(existing.counts);
          if (!existing.vendor && vendor) existing.vendor = vendor;
          continue;
        }
        byFolder.set(folder, {
          name,
          sub: str(r.entry2),
          vendor,
          sounds,
          folder,
          hasArtwork:
            folders.has(folder) || (vendor !== "" && folders.has(folderName(vendor))),
          counts,
          groups: groupsPresent(counts),
        });
      }

      const kits = [...byFolder.values()].sort(
        (a, b) => Number(a.hasArtwork) - Number(b.hasArtwork) || b.sounds - a.sounds,
      );

      return { kits, imageDir, dbPath };
    } finally {
      opened.db.close();
    }
  } catch (err) {
    return {
      kits: [],
      imageDir,
      dbPath,
      note: `Could not read the Maschine database: ${(err as Error).message}`,
    };
  } finally {
    if (cleanup) await cleanup();
  }
}
