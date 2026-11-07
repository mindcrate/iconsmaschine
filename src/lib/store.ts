import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { packsDir, safeJoin } from "./paths";
import type { KitType } from "./spec";
import type { CropMap } from "./crop";
import type { TextOverlay } from "./overlayspec";

export interface Pack {
  id: string;
  /** Display name in the app library. */
  name: string;
  kitType: KitType;
  /**
   * Properly cased vendor, e.g. "Sugar Bytes". Required for plugins, which get
   * a dist_database/<vendor>/<product>/ entry. Folders on disk are lowercased.
   */
  vendor: string;
  /** Properly cased product, e.g. "Looperator". Names the image/ folder. */
  product: string;
  nks2: boolean;
  background: string | null;
  padding: number;
  /** dist_database: "Instruments" or "Effects". */
  fileType: string;
  /** dist_database: category strings, e.g. ["Synthesizers"]. */
  categories: string[];
  /** dist_database: hardware short name. Defaults to the product name. */
  shortName: string | null;
  /** dist_database: VB_bgcolor, six hex digits with no leading hash. */
  bgColor: string;
  author: string;
  share: boolean;
  /** Your own labels for finding packs in this app. Not Maschine metadata. */
  tags: string[];
  /**
   * Nest the image folder under the vendor: `image/<vendor>/<product>/`.
   *
   * This is the layout a sample pack the user added themselves uses. Read off
   * a real system, `image/moose life/` holds no files of its own - it holds
   * `ALL BREAKS/`, `VOCALS/`, `VOODOO/` and a dozen siblings, each with its
   * own set and `.meta`. An installed expansion is the opposite: Bumpin Flava
   * has vendor "Native Instruments" and sits flat at `image/bumpin flava/`
   * with no `image/native instruments/` anywhere.
   *
   * Plugins nest regardless, via their dist_database entry.
   */
  nestImage: boolean;
  /**
   * Text burned into the logo and banner files, with the artwork behind it
   * dimmed or replaced by a flat colour. Null when the pack uses artwork
   * alone, which is the default.
   */
  overlay: TextOverlay | null;
  /** Hand-adjusted crops, keyed by output filename. */
  crops: CropMap;
  /**
   * Output files that use their own image instead of the artwork or logo, as
   * output file name -> image id. The id is the image's sha256, stored in the
   * pack folder as `source-<id>.png`. Absent on packs made before this existed.
   */
  fileSources?: Record<string, string>;
  /**
   * Where this pack was last written. Renaming the vendor or product changes
   * the install path, so without this the old folders would be orphaned in NI
   * Resources with no record that they came from here.
   */
  installedAs: InstalledIdentity | null;
  hasLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Only plugins get a dist_database entry; expansions live in image/ alone. */
export function needsDistDb(pack: Pick<Pack, "kitType">): boolean {
  return pack.kitType === "plugin";
}

export interface InstalledIdentity {
  vendor: string;
  product: string;
  /** Whether image/ was nested under the vendor. */
  nested?: boolean;
  /** Whether a dist_database entry was written too. */
  distDb: boolean;
}

/** True when the pack would now install somewhere other than last time. */
export function hasMoved(pack: Pack): boolean {
  const prev = pack.installedAs;
  if (!prev) return false;
  return (
    prev.product.trim().toLowerCase() !== pack.product.trim().toLowerCase() ||
    prev.vendor.trim().toLowerCase() !== pack.vendor.trim().toLowerCase() ||
    prev.distDb !== needsDistDb(pack)
  );
}

export const ARTWORK_FILE = "source-artwork.png";
export const LOGO_FILE = "source-logo.png";

/** A per-file image id: the sha256 of its PNG bytes. */
export const IMAGE_ID = /^[0-9a-f]{64}$/;
const imageFile = (imageId: string) => `source-${imageId}.png`;

export function newPackId(): string {
  return crypto.randomUUID();
}

function packDir(id: string): string {
  return safeJoin(packsDir(), id);
}

export async function savePack(
  pack: Pack,
  sources?: { artwork?: Buffer; logo?: Buffer | null },
): Promise<Pack> {
  const dir = packDir(pack.id);
  await fs.mkdir(dir, { recursive: true });
  const updated = { ...pack, updatedAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(dir, "pack.json"),
    JSON.stringify(updated, null, 2),
  );
  if (sources?.artwork) {
    await fs.writeFile(path.join(dir, ARTWORK_FILE), sources.artwork);
  }
  if (sources?.logo) {
    await fs.writeFile(path.join(dir, LOGO_FILE), sources.logo);
  } else if (sources && sources.logo === null) {
    await fs.rm(path.join(dir, LOGO_FILE), { force: true });
  }
  return updated;
}

export async function readPack(id: string): Promise<Pack | null> {
  try {
    const raw = await fs.readFile(path.join(packDir(id), "pack.json"), "utf8");
    return JSON.parse(raw) as Pack;
  } catch {
    return null;
  }
}

export async function readSources(
  id: string,
  fileSources: Record<string, string> = {},
): Promise<{ artwork: Buffer | null; logo: Buffer | null; files: Record<string, Buffer> }> {
  const dir = packDir(id);
  const read = async (file: string) => {
    try {
      return await fs.readFile(path.join(dir, file));
    } catch {
      return null;
    }
  };
  const files: Record<string, Buffer> = {};
  for (const [file, imageId] of Object.entries(fileSources)) {
    if (!IMAGE_ID.test(imageId)) continue;
    const buffer = await read(imageFile(imageId));
    if (buffer) files[file] = buffer;
  }
  return { artwork: await read(ARTWORK_FILE), logo: await read(LOGO_FILE), files };
}

/** One stored source: "artwork", "logo" or a per-file image id. null for anything else. */
export async function readSourceImage(id: string, which: string): Promise<Buffer | null> {
  const name =
    which === "artwork" ? ARTWORK_FILE
    : which === "logo" ? LOGO_FILE
    : IMAGE_ID.test(which) ? imageFile(which)
    : null;
  if (!name) return null;
  try {
    return await fs.readFile(path.join(packDir(id), name));
  } catch {
    return null;
  }
}

/** Stores a per-file image in the pack folder and returns its id. Saving the same bytes twice stores one file. */
export async function saveImage(id: string, png: Buffer): Promise<string> {
  const imageId = crypto.createHash("sha256").update(png).digest("hex");
  const target = path.join(packDir(id), imageFile(imageId));
  await fs.writeFile(target, png, { flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "EEXIST") throw err;
  });
  return imageId;
}

/** Deletes per-file images the pack no longer points at. */
export async function pruneImages(pack: Pack): Promise<void> {
  const keep = new Set(Object.values(pack.fileSources ?? {}));
  const dir = packDir(pack.id);
  for (const name of await fs.readdir(dir)) {
    const m = /^source-([0-9a-f]{64})\.png$/.exec(name);
    if (m && !keep.has(m[1])) await fs.rm(path.join(dir, name), { force: true });
  }
}

export async function listPacks(): Promise<Pack[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(packsDir());
  } catch {
    return [];
  }
  const packs = await Promise.all(entries.map((id) => readPack(id)));
  return packs
    .filter((p): p is Pack => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deletePack(id: string): Promise<void> {
  await fs.rm(packDir(id), { recursive: true, force: true });
}
