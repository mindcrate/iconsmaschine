import fs from "node:fs/promises";
import path from "node:path";
import { iconmaschineHome } from "./paths";

/**
 * Every NI library folder carries a `<Name>.meta` sibling. The filename has to
 * match the vendor/library name exactly; the contents are opaque and the
 * community guidance is that they are not meant to be edited.
 *
 * So rather than invent a format, we copy one harvested from a real installed
 * library when we have it, and fall back to an empty file otherwise - which is
 * what the manual tutorials do.
 */
export function metaTemplatePath(): string {
  return path.join(iconmaschineHome(), "templates", "library.meta");
}

export async function readMetaTemplate(): Promise<Buffer> {
  try {
    return await fs.readFile(metaTemplatePath());
  } catch {
    return Buffer.alloc(0);
  }
}

export async function hasMetaTemplate(): Promise<boolean> {
  try {
    const stat = await fs.stat(metaTemplatePath());
    return stat.size > 0;
  } catch {
    return false;
  }
}

export async function saveMetaTemplate(contents: Buffer): Promise<void> {
  const target = metaTemplatePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

export function metaFileName(vendor: string): string {
  return `${vendor}.meta`;
}
