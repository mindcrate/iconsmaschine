import fs from "node:fs/promises";
import path from "node:path";
import { niDistDatabaseDir, niImageDir, safeJoin } from "./paths";
import { metaBuffer } from "./nimeta";
import { buildDistDbFiles, folderName, type DistDbInput } from "./distdb";
import type { RenderedFile } from "./render";

export interface PlannedWrite {
  /** Which NI Resources tree this file lands in. */
  tree: "image" | "dist_database";
  /** Path relative to that tree's root, for display. */
  file: string;
  bytes: number;
  existing: { bytes: number; modified: string } | null;
}

export interface InstallPlan {
  imageRoot: string;
  distDbRoot: string;
  /** image/<product>/ */
  imageDir: string;
  /** dist_database/<vendor>/<product>/, or null when not applicable. */
  distDbDir: string | null;
  writes: PlannedWrite[];
  rootExists: boolean;
  rootWritable: boolean;
  warnings: string[];
}

export interface InstallInput {
  /** Properly cased product name. */
  product: string;
  /** Properly cased vendor. Only used when `distDb` is set. */
  vendor: string;
  files: RenderedFile[];
  /** Supply to also write a dist_database entry (plugins only). */
  distDb: DistDbInput | null;
}

async function statOrNull(p: string) {
  try {
    const s = await fs.stat(p);
    return { bytes: s.size, modified: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

/**
 * The full file set for a pack, across both trees.
 *
 * `image/` is flat - one folder per product, named after the product, matching
 * how the 547 installed libraries are laid out. `dist_database/` nests by
 * vendor, matching dist_database/futureaudioworkshop/sublab/.
 */
function buildFileSet(input: InstallInput) {
  const productFolder = folderName(input.product);

  const imageFiles = [
    ...input.files.map((f) => ({ file: f.file, buffer: f.buffer })),
    {
      file: `${productFolder}.meta`,
      buffer: metaBuffer({ name: input.product, type: "image" }),
    },
  ];

  const distDbFiles = input.distDb ? buildDistDbFiles(input.distDb) : [];

  return { productFolder, imageFiles, distDbFiles };
}

export async function planInstall(input: InstallInput): Promise<InstallPlan> {
  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const warnings: string[] = [];

  const { productFolder, imageFiles, distDbFiles } = buildFileSet(input);
  const imageDir = safeJoin(imageRoot, productFolder);
  const distDbDir = input.distDb
    ? safeJoin(distDbRoot, folderName(input.distDb.vendor), productFolder)
    : null;

  const rootExists = (await statOrNull(imageRoot)) !== null;
  let rootWritable = false;
  if (rootExists) {
    try {
      await fs.access(imageRoot, fs.constants.W_OK);
      rootWritable = true;
    } catch {
      warnings.push(
        `${imageRoot} is not writable by this user. Fix permissions on the folder, then install again.`,
      );
    }
  } else {
    warnings.push(
      `${imageRoot} does not exist. Create it, or point NI_RESOURCES_IMAGE_DIR at the right location.`,
    );
  }

  if (input.distDb && !(await statOrNull(distDbRoot))) {
    warnings.push(
      `${distDbRoot} does not exist yet and will be created. Maschine reads plugin metadata from there.`,
    );
  }

  if (!input.distDb) {
    warnings.push(
      "No dist_database entry for this kit type. Expansions and sample kits only appear in image/ - but artwork still only resolves once the content carries a matching Vendor property.",
    );
  }

  const writes: PlannedWrite[] = [];
  for (const f of imageFiles) {
    writes.push({
      tree: "image",
      file: path.join(productFolder, f.file),
      bytes: f.buffer.length,
      existing: await statOrNull(path.join(imageDir, f.file)),
    });
  }
  if (input.distDb && distDbDir) {
    const rel = path.join(folderName(input.distDb.vendor), productFolder);
    for (const f of distDbFiles) {
      writes.push({
        tree: "dist_database",
        file: path.join(rel, f.file),
        bytes: f.buffer.length,
        existing: await statOrNull(path.join(distDbDir, f.file)),
      });
    }
  }

  return {
    imageRoot,
    distDbRoot,
    imageDir,
    distDbDir,
    writes,
    rootExists,
    rootWritable,
    warnings,
  };
}

export interface InstallResult {
  imageDir: string;
  distDbDir: string | null;
  written: string[];
}

export async function install(input: InstallInput): Promise<InstallResult> {
  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const { productFolder, imageFiles, distDbFiles } = buildFileSet(input);

  const imageDir = safeJoin(imageRoot, productFolder);
  await fs.mkdir(imageDir, { recursive: true });

  const written: string[] = [];
  for (const f of imageFiles) {
    await fs.writeFile(safeJoin(imageDir, f.file), f.buffer);
    written.push(path.join("image", productFolder, f.file));
  }

  let distDbDir: string | null = null;
  if (input.distDb) {
    const vendorFolder = folderName(input.distDb.vendor);
    distDbDir = safeJoin(distDbRoot, vendorFolder, productFolder);
    await fs.mkdir(distDbDir, { recursive: true });
    for (const f of distDbFiles) {
      await fs.writeFile(safeJoin(distDbDir, f.file), f.buffer);
      written.push(
        path.join("dist_database", vendorFolder, productFolder, f.file),
      );
    }
  }

  return { imageDir, distDbDir, written };
}
