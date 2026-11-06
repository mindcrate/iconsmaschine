import os from "node:os";
import path from "node:path";

/** The stock macOS location. Windows equivalent is in the README. */
export const DEFAULT_NI_IMAGE_DIR = "/Users/Shared/NI Resources/image";

export function niImageDir(): string {
  const override = process.env.NI_RESOURCES_IMAGE_DIR;
  return override ? expandHome(override) : DEFAULT_NI_IMAGE_DIR;
}

/**
 * `dist_database` sits beside `image` under NI Resources. Plugins need an entry
 * in both; expansions and sample kits only appear in `image`.
 */
export function niDistDatabaseDir(): string {
  const override = process.env.NI_RESOURCES_DIST_DB_DIR;
  if (override) return expandHome(override);
  return path.join(path.dirname(niImageDir()), "dist_database");
}

export function iconmaschineHome(): string {
  const override = process.env.ICONMASCHINE_HOME;
  return override
    ? expandHome(override)
    : path.join(os.homedir(), ".iconmaschine");
}

export function packsDir(): string {
  return path.join(iconmaschineHome(), "packs");
}

/** Original WAVs, copied here before a tag is written. Never inside a library Maschine scans. */
export function backupsDir(): string {
  return path.join(iconmaschineHome(), "backups");
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Join user-supplied folder segments under `root`, refusing anything that
 * escapes it. Every write path in the app goes through here.
 */
export function safeJoin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`Invalid folder name: ${JSON.stringify(segment)}`);
    }
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      throw new Error(`Folder name cannot contain path separators: ${segment}`);
    }
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Refusing to write outside the target directory.");
  }
  return target;
}

/** Folder segments for a pack, deepest last. */
export function packSegments(vendor: string, subfolder?: string | null): string[] {
  return subfolder && subfolder.trim() ? [vendor, subfolder.trim()] : [vendor];
}
