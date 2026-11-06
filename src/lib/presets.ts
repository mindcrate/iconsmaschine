import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { editPreset, parseNksf, readSummary, type Summary } from "./nksf";

/**
 * Finding and editing NKS presets on disk.
 *
 * Every path handled here is validated to sit inside the User Content folder,
 * so a crafted request cannot read or write anywhere else on the machine.
 */

export function userContentDir(): string {
  const override = process.env.NI_USER_CONTENT_DIR;
  if (override) {
    return override.startsWith("~")
      ? path.join(os.homedir(), override.slice(1))
      : override;
  }
  return path.join(os.homedir(), "Documents", "Native Instruments", "User Content");
}

const PRESET_EXTENSIONS = new Set([".nksf", ".nksn", ".nksfx"]);

export class OutsideUserContentError extends Error {
  constructor() {
    super("That path is outside the User Content folder.");
    this.name = "OutsideUserContentError";
  }
}

/** Resolves a caller-supplied path, refusing anything outside User Content. */
export function resolvePresetPath(relativeOrAbsolute: string): string {
  const root = path.resolve(userContentDir());
  const target = path.resolve(root, relativeOrAbsolute);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new OutsideUserContentError();
  }
  if (!PRESET_EXTENSIONS.has(path.extname(target).toLowerCase())) {
    throw new Error("Only .nksf, .nksn and .nksfx files can be edited.");
  }
  return target;
}

export interface PresetEntry {
  /** Path relative to User Content - what the UI and API pass around. */
  relPath: string;
  name: string;
  vendor: string;
  bankchain: string[];
  types: string[][];
  characters: string[];
  deviceType: string;
  bytes: number;
  /** Set when the file exists but could not be parsed. */
  error?: string;
}

/**
 * Absolute paths of the preset files under a directory, to the same depth and
 * with the same dot-file skip everywhere. Regular files only, so a symlinked
 * preset cannot point a later write outside User Content.
 */
export async function presetFilesUnder(absDir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (
        entry.isFile() &&
        PRESET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        found.push(full);
      }
    }
  };
  await walk(absDir, 0);
  return found;
}

export async function listPresets(): Promise<{
  root: string;
  rootExists: boolean;
  presets: PresetEntry[];
}> {
  const root = userContentDir();
  const presets: PresetEntry[] = [];

  let rootExists = true;
  try {
    await fs.access(root);
  } catch {
    rootExists = false;
  }

  if (rootExists) {
    for (const full of await presetFilesUnder(root)) {
      const relPath = path.relative(root, full);
      try {
        const buf = await fs.readFile(full);
        const { summary } = readSummary(parseNksf(buf));
        presets.push({
          relPath,
          name: summary.name,
          vendor: summary.vendor,
          bankchain: summary.bankchain,
          types: summary.types,
          characters: summary.characters,
          deviceType: summary.deviceType,
          bytes: buf.length,
        });
      } catch (err) {
        presets.push({
          relPath,
          name: path.basename(full, path.extname(full)),
          vendor: "",
          bankchain: [],
          types: [],
          characters: [],
          deviceType: "",
          bytes: 0,
          error: (err as Error).message,
        });
      }
    }
  }

  presets.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root, rootExists, presets };
}

export async function readPreset(relPath: string): Promise<{
  relPath: string;
  summary: Summary;
}> {
  const full = resolvePresetPath(relPath);
  const buf = await fs.readFile(full);
  return { relPath, summary: readSummary(parseNksf(buf)).summary };
}

export interface PresetEdit {
  vendor?: string;
  bankchain?: string[];
  types?: string[][];
  characters?: string[];
  author?: string;
  comment?: string;
}

export interface WriteResult {
  relPath: string;
  backupPath: string | null;
  bytesBefore: number;
  bytesAfter: number;
  unchanged: boolean;
}

/**
 * Applies an edit in place.
 *
 * In place is the only useful option - Maschine reads the file where it is -
 * so a `.bak` is written alongside first. An existing `.bak` is never
 * overwritten, so the very first original is always recoverable.
 */
export async function writePreset(
  relPath: string,
  edit: PresetEdit,
  opts: { backup?: boolean } = {},
): Promise<WriteResult> {
  const full = resolvePresetPath(relPath);
  const before = await fs.readFile(full);

  const after = editPreset(before, (s) => ({
    ...s,
    vendor: edit.vendor ?? s.vendor,
    bankchain: edit.bankchain ?? s.bankchain,
    types: edit.types ?? s.types,
    characters: edit.characters ?? s.characters,
    author: edit.author ?? s.author,
    comment: edit.comment ?? s.comment,
  }));

  if (after.equals(before)) {
    return {
      relPath,
      backupPath: null,
      bytesBefore: before.length,
      bytesAfter: after.length,
      unchanged: true,
    };
  }

  let backupPath: string | null = null;
  if (opts.backup !== false) {
    const candidate = `${full}.bak`;
    try {
      await fs.access(candidate);
      // A .bak already exists: it holds the true original, so leave it.
      backupPath = candidate;
    } catch {
      await fs.writeFile(candidate, before);
      backupPath = candidate;
    }
  }

  await fs.writeFile(full, after);

  return {
    relPath,
    backupPath,
    bytesBefore: before.length,
    bytesAfter: after.length,
    unchanged: false,
  };
}

/** Puts a preset back from its .bak. */
export async function restorePreset(relPath: string): Promise<void> {
  const full = resolvePresetPath(relPath);
  const backup = `${full}.bak`;
  await fs.access(backup);
  await fs.copyFile(backup, full);
}
