import crypto from "node:crypto";
import { PackNotFound } from "./build";
import { BadRequest } from "./form";
import { IMAGE_SPECS } from "./spec";
import {
  listPacks,
  pruneImages,
  readPack,
  readSourceImage,
  saveImage,
  savePack,
  type Pack,
} from "./store";

/**
 * Replacing a pack's images after it is built. A file can have its own image,
 * or the artwork or logo can be replaced for every file that uses it.
 */

export type ReplaceScope =
  | { kind: "file"; file: string }
  | { kind: "artwork" }
  | { kind: "logo" };

export interface LibraryImage {
  imageId: string;
  packId: string;
  packName: string;
  /** "artwork", "logo" or a per-file image id: the `which` the source route takes. */
  which: string;
  url: string;
}

const KNOWN_FILES = new Set(IMAGE_SPECS.map((s) => s.file));

/** The files that currently render from the artwork, or from the logo. */
function groupFiles(pack: Pack, kind: "artwork" | "logo"): string[] {
  return IMAGE_SPECS.filter((s) =>
    kind === "logo"
      ? s.source === "logo"
      : s.source === "artwork" || !pack.hasLogo,
  ).map((s) => s.file);
}

export async function replacePackImage(
  packId: string,
  scope: ReplaceScope,
  png: Buffer,
): Promise<{ pack: Pack; skipped: string[] }> {
  const pack = await readPack(packId);
  if (!pack) throw new PackNotFound();
  const own = { ...(pack.fileSources ?? {}) };
  const crops = { ...(pack.crops ?? {}) };

  if (scope.kind === "file") {
    if (!KNOWN_FILES.has(scope.file)) throw new BadRequest(`Unknown output file: ${scope.file}`);
    own[scope.file] = await saveImage(packId, png);
    delete crops[scope.file];
    const saved = await savePack({ ...pack, fileSources: own, crops });
    await pruneImages(saved);
    return { pack: saved, skipped: [] };
  }

  const group = groupFiles(pack, scope.kind);
  const skipped = group.filter((f) => f in own);
  for (const f of group) if (!(f in own)) delete crops[f];
  const saved = await savePack(
    { ...pack, crops, ...(scope.kind === "logo" ? { hasLogo: true } : {}) },
    scope.kind === "artwork" ? { artwork: png } : { logo: png },
  );
  return { pack: saved, skipped };
}

/** Puts a file back on the pack's artwork or logo. */
export async function clearFileImage(packId: string, file: string): Promise<Pack> {
  const pack = await readPack(packId);
  if (!pack) throw new PackNotFound();
  const own = { ...(pack.fileSources ?? {}) };
  const crops = { ...(pack.crops ?? {}) };
  delete own[file];
  delete crops[file];
  const saved = await savePack({ ...pack, fileSources: own, crops });
  await pruneImages(saved);
  return saved;
}

/** Every source image saved in the app, each content once, newest pack first. */
export async function listLibrary(): Promise<LibraryImage[]> {
  const seen = new Map<string, LibraryImage>();
  for (const pack of await listPacks()) {
    const whiches = ["artwork", "logo", ...new Set(Object.values(pack.fileSources ?? {}))];
    for (const which of whiches) {
      const buffer = await readSourceImage(pack.id, which);
      if (!buffer) continue;
      const imageId = crypto.createHash("sha256").update(buffer).digest("hex");
      if (seen.has(imageId)) continue;
      seen.set(imageId, {
        imageId,
        packId: pack.id,
        packName: pack.name,
        which,
        url: `/api/packs/${pack.id}/source?which=${which}`,
      });
    }
  }
  return [...seen.values()];
}
