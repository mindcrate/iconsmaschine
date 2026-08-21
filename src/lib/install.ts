import fs from "node:fs/promises";
import path from "node:path";
import { niImageDir, packSegments, safeJoin } from "./paths";
import { metaFileName, readMetaTemplate } from "./meta";
import type { RenderedFile } from "./render";

export interface PlannedWrite {
  file: string;
  bytes: number;
  /** What is already at this path, if anything. */
  existing: { bytes: number; modified: string } | null;
}

export interface InstallPlan {
  root: string;
  targetDir: string;
  /** Relative to `root`, for display. */
  relativeDir: string;
  writes: PlannedWrite[];
  rootExists: boolean;
  rootWritable: boolean;
  warnings: string[];
}

export interface InstallInput {
  vendor: string;
  subfolder: string | null;
  files: RenderedFile[];
  /** Written at the vendor level, named after the vendor folder. */
  writeMeta: boolean;
}

async function statOrNull(p: string) {
  try {
    const s = await fs.stat(p);
    return { bytes: s.size, modified: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

export async function planInstall(input: InstallInput): Promise<InstallPlan> {
  const root = niImageDir();
  const segments = packSegments(input.vendor, input.subfolder);
  const targetDir = safeJoin(root, ...segments);
  const warnings: string[] = [];

  const rootExists = (await statOrNull(root)) !== null;
  let rootWritable = false;
  if (rootExists) {
    try {
      await fs.access(root, fs.constants.W_OK);
      rootWritable = true;
    } catch {
      warnings.push(
        `${root} is not writable by this user. Fix permissions on the folder, then install again.`,
      );
    }
  } else {
    warnings.push(
      `${root} does not exist. Create it, or point NI_RESOURCES_IMAGE_DIR at the right location.`,
    );
  }

  const writes: PlannedWrite[] = [];
  for (const f of input.files) {
    writes.push({
      file: path.join(...segments, f.file),
      bytes: f.buffer.length,
      existing: await statOrNull(path.join(targetDir, f.file)),
    });
  }

  if (input.writeMeta) {
    const template = await readMetaTemplate();
    const metaName = metaFileName(input.vendor);
    // The .meta always sits beside the vendor folder's own level.
    const metaPath = safeJoin(root, input.vendor, metaName);
    writes.push({
      file: path.join(input.vendor, metaName),
      bytes: template.length,
      existing: await statOrNull(metaPath),
    });
    if (template.length === 0) {
      warnings.push(
        `No .meta template harvested yet, so ${metaName} will be written empty. Run Calibrate to copy one from a real NI library.`,
      );
    }
  }

  return {
    root,
    targetDir,
    relativeDir: segments.join(path.sep),
    writes,
    rootExists,
    rootWritable,
    warnings,
  };
}

export interface InstallResult {
  targetDir: string;
  written: string[];
}

export async function install(input: InstallInput): Promise<InstallResult> {
  const root = niImageDir();
  const segments = packSegments(input.vendor, input.subfolder);
  const targetDir = safeJoin(root, ...segments);

  await fs.mkdir(targetDir, { recursive: true });
  const written: string[] = [];

  for (const f of input.files) {
    const target = safeJoin(targetDir, f.file);
    await fs.writeFile(target, f.buffer);
    written.push(path.join(...segments, f.file));
  }

  if (input.writeMeta) {
    const metaName = metaFileName(input.vendor);
    const metaPath = safeJoin(root, input.vendor, metaName);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, await readMetaTemplate());
    written.push(path.join(input.vendor, metaName));
  }

  return { targetDir, written };
}
