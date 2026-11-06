import { renderPack, type RenderedFile } from "./render";
import { specsFor } from "./spec";
import { needsDistDb, readPack, readSources, type Pack } from "./store";
import type { DistDbInput } from "./distdb";

export class PackNotFound extends Error {
  constructor() {
    super("Pack not found.");
    this.name = "PackNotFound";
  }
}

/** Loads a saved pack and renders every spec'd file from its stored sources. */
export async function buildPack(
  id: string,
): Promise<{ pack: Pack; files: RenderedFile[] }> {
  const pack = await readPack(id);
  if (!pack) throw new PackNotFound();

  const sources = await readSources(id);
  if (!sources.artwork) {
    throw new Error("This pack has no artwork image stored.");
  }

  const files = await renderPack(
    { artwork: sources.artwork, logo: sources.logo },
    specsFor({ nks2: pack.nks2 }),
    { background: pack.background, padding: pack.padding, overlay: pack.overlay },
    pack.crops ?? {},
  );

  return { pack, files };
}

/** The dist_database payload for a pack, or null when its type does not use one. */
export function distDbInputFor(pack: Pack): DistDbInput | null {
  if (!needsDistDb(pack)) return null;
  return {
    vendor: pack.vendor,
    product: pack.product,
    fileType: pack.fileType,
    categories: pack.categories,
    bgColor: pack.bgColor,
    shortName: pack.shortName,
  };
}
