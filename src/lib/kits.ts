import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
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

/**
 * Where an installed library's audio lives. Content outside these is something
 * the user added through Preferences > Library > User, and nests in image/.
 */
const INSTALLED_ROOTS = ["/Users/Shared/", "/Library/", "/Applications/"];

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
  matchedBy: "nested" | "name" | "vendor" | null;
  /**
   * Vendor folder this kit's artwork nests under, when it is content the user
   * added. null for an installed expansion, which sits flat.
   */
  nestUnder: string | null;
  /**
   * True when none of the folders holding this kit's audio is on disk any
   * more. Maschine keeps the bank chain after a library is removed, so these
   * rows outlive the content and cannot be given artwork that would ever
   * show. May also mean the drive is simply not mounted.
   */
  contentMissing: boolean;
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

  // Every folder under image/ that DIRECTLY holds at least one of the files we
  // write, as a lowercased relative path of one or two segments. Two levels is
  // all the tree ever uses: `image/<product>/` for an installed expansion,
  // `image/<vendor>/<product>/` for a plugin or a user sample pack.
  const directArt = new Set<string>();
  const scan = async (rel: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(rel ? `${imageDir}/${rel}` : imageDir, {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    if (rel && entries.some((e) => e.isFile() && artFiles.has(e.name.toLowerCase()))) {
      directArt.add(rel.toLowerCase());
    }
    if (depth >= 2) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => scan(rel ? `${rel}/${e.name}` : e.name, depth + 1)),
    );
  };
  await scan("", 0);

  /** Art directly here, or in any folder beneath - a plugin vendor's case. */
  const anyArt = (folder: string) => {
    if (directArt.has(folder)) return true;
    const prefix = `${folder}/`;
    for (const p of directArt) if (p.startsWith(prefix)) return true;
    return false;
  };

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

      // Which chains still have audio on disk. Maschine does not clean up
      // k_bank_chain when a user library is removed, so hundreds of chains can
      // outlive their content - one machine had ~700 for deleted sample packs.
      // Offering artwork for those is offering to paint a wall that is gone.
      // The vendor recorded on the SOUNDS, which is what the walkthrough has
      // you set (Edit > Properties > Vendor > Apply) and what decides the
      // artwork folder. k_bank_chain.bcvendor is a different field and does
      // not follow that edit: after setting 808 COLLECTION's 30 sounds to
      // "tim moose", bcvendor still read "Other". Reading only bcvendor would
      // have written to the flat path while Maschine looked in the nested one.
      const chainSoundVendor = new Map<number, string>();
      {
        const counts = new Map<number, Map<string, number>>();
        for (const r of tryAll(
          opened.db,
          `SELECT bank_chain_id AS id, vendor AS v, COUNT(*) AS n
           FROM k_sound_info WHERE vendor IS NOT NULL AND vendor != ''
           GROUP BY bank_chain_id, vendor`,
        )) {
          const id = Number(r.id);
          const v = str(r.v);
          if (!v || !effectiveVendor(v)) continue;
          const m = counts.get(id) ?? new Map<string, number>();
          m.set(v, (m.get(v) ?? 0) + Number(r.n ?? 0));
          counts.set(id, m);
        }
        // A chain can hold sounds from several vendors; the commonest wins.
        for (const [id, m] of counts) {
          const top = [...m].sort((a, b) => b[1] - a[1])[0];
          if (top) chainSoundVendor.set(id, top[0]);
        }
      }

      const livePaths = new Map<string, boolean>();
      const chainLive = new Map<number, boolean>();
      const chainInstalled = new Map<number, boolean>();
      const pathRows = tryAll(
        opened.db,
        `SELECT DISTINCT s.bank_chain_id AS id, p.path AS path
         FROM k_sound_info s JOIN k_content_path p ON p.id = s.content_path_id`,
      );
      // No path information at all - an older schema, or a query that failed.
      // Then we know nothing about what is on disk, and must not accuse every
      // kit of being gone.
      const pathsKnown = pathRows.length > 0;
      for (const r of pathRows) {
        const id = Number(r.id);
        const p = str(r.path);
        if (!p) continue;
        let live = livePaths.get(p);
        if (live === undefined) {
          live = existsSync(p);
          livePaths.set(p, live);
        }
        // A chain is live if ANY of its content folders is still there.
        if (live || !chainLive.has(id)) chainLive.set(id, live || chainLive.get(id) === true);
        // Installed libraries live in the shared or system trees; anything
        // else is content the user added themselves, which is laid out
        // differently in image/.
        if (INSTALLED_ROOTS.some((r) => p.startsWith(r))) chainInstalled.set(id, true);
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

        // Prefer the sounds' own vendor; fall back to the chain's.
        const vendor =
          chainSoundVendor.get(Number(r.id)) ?? effectiveVendor(str(r.bcvendor));
        const counts = byChain.get(Number(r.id));
        if (!counts) continue;
        const sounds = total(counts);
        if (sounds === 0) continue;

        const chainId = Number(r.id);
        const installed = chainInstalled.get(chainId) === true;
        const vendorFolder = vendor ? folderName(vendor) : null;
        const nameFolder = folderName(name);

        // An installed expansion sits flat under its product name - that is
        // Bumpin Flava, confirmed working, whose vendor is "Native
        // Instruments" with no image/native instruments/ anywhere. A pack the
        // user added nests under its vendor, which is the layout the original
        // app produced: image/moose life/ALL BREAKS/, .../VOCALS/ and so on.
        const nestUnder = !installed && vendorFolder ? vendorFolder : null;
        const nested = nestUnder ? `${nestUnder}/${nameFolder}` : null;
        const folder = nested ?? nameFolder;
        const altFolder =
          nested
            ? nameFolder
            : vendorFolder && vendorFolder !== nameFolder
              ? vendorFolder
              : null;

        const live = !pathsKnown || chainLive.get(chainId) === true;

        const existing = byFolder.get(folder);
        if (existing) {
          existing.sounds += sounds;
          for (const k of Object.keys(counts) as (keyof ContentCounts)[]) {
            existing.counts[k] += counts[k];
          }
          existing.groups = groupsPresent(existing.counts);
          if (!existing.vendor && vendor) existing.vendor = vendor;
          // One live chain is enough to make the kit real.
          if (live) existing.contentMissing = false;
          continue;
        }

        const matchedBy =
          nested && directArt.has(nested)
            ? ("nested" as const)
            : anyArt(nameFolder)
              ? ("name" as const)
              : vendorFolder && anyArt(vendorFolder)
                ? ("vendor" as const)
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
          nestUnder,
          contentMissing: !live,
          counts,
          groups: groupsPresent(counts),
        });
      }

      const kits = [...byFolder.values()].sort(
        (a, b) =>
          Number(a.contentMissing) - Number(b.contentMissing) ||
          Number(a.hasArtwork) - Number(b.hasArtwork) ||
          b.sounds - a.sounds,
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

export interface SampleTarget {
  /** Absolute path of the WAV, as Maschine recorded it. */
  path: string;
  /** The sample's own bank chain, entries in order, empty ones dropped. */
  bankchain: string[];
}

/**
 * The WAV files Maschine lists under a user library, each with the bank chain
 * it sits in. Content Maschine installed itself is left out: it is not ours to
 * edit.
 */
export async function userLibrarySamples(
  product: string,
): Promise<{ samples: SampleTarget[]; note?: string }> {
  const dbPath = findMaschineDb();
  if (!dbPath) {
    return {
      samples: [],
      note: "No Maschine database found, so the library's WAV files could not be listed.",
    };
  }

  let cleanup: (() => Promise<void>) | null = null;
  try {
    const opened = await openMaschineDb(dbPath);
    cleanup = opened.cleanup;
    try {
      const wanted = product.trim().toLowerCase().replaceAll("'", "''");
      const rows = tryAll(
        opened.db,
        `SELECT s.file_name AS file, p.path AS root,
                b.entry1 AS e1, b.entry2 AS e2, b.entry3 AS e3
         FROM k_sound_info s
         JOIN k_bank_chain b ON b.id = s.bank_chain_id
         LEFT JOIN k_content_path p ON p.id = s.content_path_id
         WHERE lower(trim(b.entry1)) = '${wanted}' AND lower(s.file_ext) = 'wav'
         ORDER BY s.file_name`,
      );

      const seen = new Set<string>();
      const samples: SampleTarget[] = [];
      for (const r of rows) {
        const file = str(r.file);
        if (!file || !path.isAbsolute(file) || seen.has(file)) continue;
        if (INSTALLED_ROOTS.some((root) => str(r.root).startsWith(root))) continue;
        seen.add(file);
        samples.push({
          path: file,
          bankchain: [str(r.e1), str(r.e2), str(r.e3)].filter(Boolean),
        });
      }
      return { samples };
    } finally {
      opened.db.close();
    }
  } catch (err) {
    return {
      samples: [],
      note: `Could not read the Maschine database: ${(err as Error).message}`,
    };
  } finally {
    if (cleanup) await cleanup();
  }
}
