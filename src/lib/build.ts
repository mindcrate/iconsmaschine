import { renderPack, type RenderedFile } from "./render";
import { specsFor } from "./spec";
import { readPack, readSources, type Pack } from "./store";

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
    { background: pack.background, padding: pack.padding },
  );

  return { pack, files };
}
