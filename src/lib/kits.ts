import fs from "node:fs/promises";
import { findMaschineDb, openMaschineDb, str, tryAll } from "./maschinedb";
import { niImageDir } from "./paths";
import { folderName } from "./distdb";
import { IMAGE_SPECS } from "./spec";
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
 * The folder a kit's artwork lives in is decided by whether it has a vendor:
 *
 *   has a vendor  ->  image/<vendor>/
 *   no vendor     ->  image/<bank chain entry1>/
 *
 * Vendor-first is NOT well established, and the count that suggested it does
 * not support it. Across products where the two names differ, vendor matched
 * an image folder 1,031 times against the bank chain's 105 - but that counts
 * which folders happen to exist on one machine, not which ones Maschine
 * reads. The overwhelming majority of those vendor matches are one user's own
 * `image/moose life/`, shared by 700-odd of their sample banks, and none of
 * them is confirmed to display anything.
 *
 * The products confirmed to display artwork point the other way. Every NI
 * expansion - Bumpin Flava, Arcane Attic, Astral Flutter, Conant Gardens -
 * carries vendor "Native Instruments", there is no `image/native
 * instruments/`, and each matches on its product name instead.
 *
 * So treat both as candidates and offer both: `folder` is tried first,
 * `altFolder` carries the other. Do not harden this into a single rule
 * without a case where artwork is seen to appear and disappear with the
 * folder name.
 */

export interface Kit {
  /** The bank chain's first entry - what names the image folder. */
  name: string;
  /** Second entry, where there is one. Shown for context only. */
  sub: string;
  vendor: string;
  sounds: number;
  /** Folder this kit's artwork should live in, relative to image/. */
  folder: string;
  /** The other candidate, when a kit has both a vendor and a name. */
  altFolder: string | null;
  hasArtwork: boolean;
  /** Which of the two actually has a folder on disk. */
  matchedBy: "vendor" | "name" | null;
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

  // An EMPTY folder is not artwork. Matching on the folder name alone counted
  // one as done, so a kit resolving to a bare `image/<vendor>/` looked finished
  // while Maschine had nothing to draw. A folder counts only if it holds at
  // least one of the files we write - directly, or in a subfolder, since a
  // plugin vendor's images sit one level down in `image/<vendor>/<product>/`.
  const artFiles = new Set(IMAGE_SPECS.map((s) => s.file.toLowerCase()));
  const hasArt = async (dir: string): Promise<boolean> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    if (entries.some((e) => e.isFile() && artFiles.has(e.name.toLowerCase()))) {
      return true;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (await hasArt(`${dir}/${e.name}`)) return true;
    }
    return false;
  };

  let folders: Set<string>;
  try {
    const entries = (await fs.readdir(imageDir, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );
    const filled = await Promise.all(
      entries.map(async (e) => ((await hasArt(`${imageDir}/${e.name}`)) ? e.name.toLowerCase() : null)),
    );
    folders = new Set(filled.filter((n): n is string => n !== null));
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

        // Vendor first: that is what Maschine matches on when one is set.
        const vendorFolder = vendor ? folderName(vendor) : null;
        const nameFolder = folderName(name);
        const folder = vendorFolder ?? nameFolder;
        const altFolder = vendorFolder && vendorFolder !== nameFolder ? nameFolder : null;

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

        const matchedBy = folders.has(folder)
          ? vendorFolder
            ? ("vendor" as const)
            : ("name" as const)
          : altFolder && folders.has(altFolder)
            ? ("name" as const)
            : null;

        byFolder.set(folder, {
          name,
          sub: str(r.entry2),
          vendor,
          sounds,
          folder,
          altFolder,
          hasArtwork: matchedBy !== null,
          matchedBy,
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
