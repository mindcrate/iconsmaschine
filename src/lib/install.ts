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
  /** Folders a rename has left behind, which Install can also clean up. */
  staleDirs: string[];
}

export interface InstallInput {
  /** Properly cased product name. */
  product: string;
  /** Properly cased vendor. Only used when `distDb` is set. */
  vendor: string;
  files: RenderedFile[];
  /** Supply to also write a dist_database entry (plugins only). */
  distDb: DistDbInput | null;
  /**
   * Where this pack was last installed, when that differs from where it would
   * go now. Renaming moves the install path, and without this the previous
   * folders would be left behind with nothing pointing at them.
   */
  previous?: { vendor: string; product: string; distDb: boolean } | null;
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
 * Nesting is NOT uniform. Confirmed against an installed system:
 *
 *   image/futureaudioworkshop/sublab/   plugin  -> nested, mirrors dist_database
 *   image/amplified funk/               expansion -> flat, product only
 *
 * So a plugin's image folder mirrors its dist_database path, while expansions
 * and Kontakt libraries sit flat at the top level.
 */
function buildFileSet(input: InstallInput) {
  const productFolder = folderName(input.product);

  // A dist_database entry means a plugin, and plugins nest in image/ as well.
  const imageSegments = input.distDb
    ? [folderName(input.distDb.vendor), productFolder]
    : [productFolder];

  const imageFiles = [
    ...input.files.map((f) => ({ file: f.file, buffer: f.buffer })),
    {
      file: `${productFolder}.meta`,
      buffer: metaBuffer({ name: input.product, type: "image" }),
    },
  ];

  const distDbFiles = input.distDb ? buildDistDbFiles(input.distDb) : [];

  return { productFolder, imageSegments, imageFiles, distDbFiles };
}

export async function planInstall(input: InstallInput): Promise<InstallPlan> {
  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const warnings: string[] = [];

  const { productFolder, imageSegments, imageFiles, distDbFiles } =
    buildFileSet(input);
  const imageDir = safeJoin(imageRoot, ...imageSegments);
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
  const imageRel = path.join(...imageSegments);
  for (const f of imageFiles) {
    writes.push({
      tree: "image",
      file: path.join(imageRel, f.file),
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

  const staleDirs = await findStaleDirs(input);
  if (staleDirs.length > 0) {
    warnings.push(
      `This pack was last installed as "${input.previous!.vendor ? input.previous!.vendor + " / " : ""}${input.previous!.product}". Installing now writes to a new location, leaving the old folders behind unless they are cleaned up.`,
    );
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
    staleDirs,
  };
}

/** The folders a rename has stranded, if they still exist. */
async function findStaleDirs(input: InstallInput): Promise<string[]> {
  const prev = input.previous;
  if (!prev) return [];

  const sameProduct =
    folderName(prev.product) === folderName(input.product);
  const sameVendor = folderName(prev.vendor) === folderName(input.vendor);
  const sameShape = prev.distDb === Boolean(input.distDb);
  if (sameProduct && sameVendor && sameShape) return [];

  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const oldProduct = folderName(prev.product);
  const oldVendor = folderName(prev.vendor);

  const candidates: string[] = [];
  try {
    candidates.push(
      prev.distDb
        ? safeJoin(imageRoot, oldVendor, oldProduct)
        : safeJoin(imageRoot, oldProduct),
    );
    if (prev.distDb) {
      candidates.push(safeJoin(distDbRoot, oldVendor, oldProduct));
    }
  } catch {
    return []; // an unusable old name is not worth acting on
  }

  const newImage = (await planPaths(input)).imageDir;
  const out: string[] = [];
  for (const dir of candidates) {
    if (dir === newImage) continue;
    if (await statOrNull(dir)) out.push(dir);
  }
  return out;
}

async function planPaths(input: InstallInput) {
  const { imageSegments } = buildFileSet(input);
  return { imageDir: safeJoin(niImageDir(), ...imageSegments) };
}

export interface InstallResult {
  imageDir: string;
  distDbDir: string | null;
  written: string[];
  /** Folders removed because a rename stranded them. */
  cleaned: string[];
}

export async function install(
  input: InstallInput,
  opts: { cleanStale?: boolean } = {},
): Promise<InstallResult> {
  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const { productFolder, imageSegments, imageFiles, distDbFiles } =
    buildFileSet(input);

  const imageDir = safeJoin(imageRoot, ...imageSegments);
  await fs.mkdir(imageDir, { recursive: true });

  const written: string[] = [];
  for (const f of imageFiles) {
    await fs.writeFile(safeJoin(imageDir, f.file), f.buffer);
    written.push(path.join("image", ...imageSegments, f.file));
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

  // Clear the previous location only after the new one is safely written.
  const cleaned: string[] = [];
  if (opts.cleanStale && input.previous) {
    const stale = await findStaleDirs(input);
    const names = new Set([
      ...imageFiles.map((f) => f.file),
      ...distDbFiles.map((f) => f.file),
      // The old folder is named after the old product, so its .meta is too.
      `${folderName(input.previous.product)}.meta`,
    ]);
    for (const dir of stale) {
      const removed = await removeOurFiles(dir, names);
      if (removed) cleaned.push(dir);
    }
  }

  return { imageDir, distDbDir, written, cleaned };
}

/**
 * Deletes only the filenames this app writes, then the folder if it is empty.
 * A folder holding anything else is left alone - it may be a real NI library.
 */
async function removeOurFiles(dir: string, names: Set<string>): Promise<boolean> {
  let present: string[];
  try {
    present = await fs.readdir(dir);
  } catch {
    return false;
  }
  for (const name of present) {
    if (names.has(name)) await fs.rm(safeJoin(dir, name), { force: true });
  }
  const left = (await fs.readdir(dir).catch(() => [] as string[])).filter(
    (f) => f !== ".DS_Store",
  );
  if (left.length > 0) return false;
  await fs.rm(path.join(dir, ".DS_Store"), { force: true });
  await fs.rmdir(dir).catch(() => {});
  // Prune a vendor folder left empty by this.
  const parent = path.dirname(dir);
  const siblings = (await fs.readdir(parent).catch(() => ["keep"])).filter(
    (f) => f !== ".DS_Store",
  );
  if (siblings.length === 0) await fs.rmdir(parent).catch(() => {});
  return true;
}


export interface UninstallResult {
  removed: string[];
  /** Folders left in place because they held files this app did not write. */
  keptFolders: string[];
}

/**
 * Remove a pack's installed files.
 *
 * Deliberately conservative: it deletes only the exact filenames this app
 * writes, then removes a folder only once it is empty. A folder holding
 * anything else - a real NI library that happens to share a name - is left
 * alone and reported.
 */
export async function uninstall(input: InstallInput): Promise<UninstallResult> {
  const imageRoot = niImageDir();
  const distDbRoot = niDistDatabaseDir();
  const { imageSegments, imageFiles, distDbFiles } = buildFileSet(input);

  const removed: string[] = [];
  const keptFolders: string[] = [];

  const clean = async (
    dir: string,
    names: string[],
    label: string,
  ): Promise<void> => {
    let present: string[];
    try {
      present = await fs.readdir(dir);
    } catch {
      return; // nothing installed there
    }
    for (const name of names) {
      if (!present.includes(name)) continue;
      await fs.rm(safeJoin(dir, name), { force: true });
      removed.push(path.join(label, name));
    }
    const left = await fs.readdir(dir).catch(() => [] as string[]);
    const ignorable = left.filter((f) => f !== ".DS_Store");
    if (ignorable.length === 0) {
      await fs.rm(path.join(dir, ".DS_Store"), { force: true });
      await fs.rmdir(dir).catch(() => {});
    } else {
      keptFolders.push(`${dir} (still holds ${ignorable.length} other file(s))`);
    }
  };

  await clean(
    safeJoin(imageRoot, ...imageSegments),
    imageFiles.map((f) => f.file),
    path.join("image", ...imageSegments),
  );

  if (input.distDb) {
    const vendorFolder = folderName(input.distDb.vendor);
    const productFolder = folderName(input.product);
    await clean(
      safeJoin(distDbRoot, vendorFolder, productFolder),
      distDbFiles.map((f) => f.file),
      path.join("dist_database", vendorFolder, productFolder),
    );
    // Drop the vendor folder too, if nothing else lives in it.
    const vendorDir = safeJoin(distDbRoot, vendorFolder);
    const left = await fs.readdir(vendorDir).catch(() => ["keep"]);
    if (left.filter((f) => f !== ".DS_Store").length === 0) {
      await fs.rm(path.join(vendorDir, ".DS_Store"), { force: true });
      await fs.rmdir(vendorDir).catch(() => {});
    }
  }

  // Same for a plugin's image vendor folder.
  if (imageSegments.length > 1) {
    const vendorDir = safeJoin(imageRoot, imageSegments[0]);
    const left = await fs.readdir(vendorDir).catch(() => ["keep"]);
    if (left.filter((f) => f !== ".DS_Store").length === 0) {
      await fs.rm(path.join(vendorDir, ".DS_Store"), { force: true });
      await fs.rmdir(vendorDir).catch(() => {});
    }
  }

  return { removed, keptFolders };
}
