import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { niImageDir } from "./paths";
import { IMAGE_SPECS } from "./spec";
import { saveMetaTemplate } from "./meta";

export interface Observation {
  file: string;
  /** Sizes seen in the wild, most common first. */
  sizes: { width: number; height: number; count: number }[];
  expected: { width: number; height: number } | null;
  matchesSpec: boolean | null;
}

export interface CalibrationResult {
  scannedRoot: string;
  libraries: string[];
  observations: Observation[];
  metaTemplateHarvestedFrom: string | null;
  errors: string[];
}

const KNOWN_FILES = new Set(IMAGE_SPECS.map((s) => s.file));

/** Vendor folder, then one level of plugin subfolders. */
const MAX_DEPTH = 2;

/**
 * Read the image folders Native Instruments itself installed and report the
 * dimensions they actually use. This is the ground truth for the two things the
 * public docs don't cover: VB_logo.png's size, and what a real `.meta` contains.
 */
export async function calibrate(
  opts: { harvestMeta?: boolean } = {},
): Promise<CalibrationResult> {
  const root = niImageDir();
  const errors: string[] = [];
  const libraries: string[] = [];
  const seen = new Map<string, Map<string, number>>();
  let metaSource: string | null = null;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    return {
      scannedRoot: root,
      libraries: [],
      observations: [],
      metaTemplateHarvestedFrom: null,
      errors: [`Could not read ${root}: ${(err as Error).message}`],
    };
  }

  /**
   * Scans one folder. Plugin vendors nest a folder per plugin
   * (e.g. Sugar Bytes/Looperator), so this recurses one level to find those.
   */
  const scanDir = async (dir: string, label: string, depth: number) => {
    let files: import("node:fs").Dirent[];
    try {
      files = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
      return;
    }

    for (const file of files) {
      if (file.isDirectory()) {
        if (depth < MAX_DEPTH && !file.name.startsWith(".")) {
          await scanDir(
            path.join(dir, file.name),
            path.join(label, file.name),
            depth + 1,
          );
        }
        continue;
      }

      if (opts.harvestMeta && !metaSource && file.name.endsWith(".meta")) {
        try {
          const contents = await fs.readFile(path.join(dir, file.name));
          if (contents.length > 0) {
            await saveMetaTemplate(contents, path.basename(file.name, ".meta"));
            metaSource = path.join(label, file.name);
          }
        } catch (err) {
          errors.push(`${label}/${file.name}: ${(err as Error).message}`);
        }
      }

      if (!KNOWN_FILES.has(file.name)) continue;
      try {
        const meta = await sharp(path.join(dir, file.name)).metadata();
        if (!meta.width || !meta.height) continue;
        const key = `${meta.width}x${meta.height}`;
        const bucket = seen.get(file.name) ?? new Map<string, number>();
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
        seen.set(file.name, bucket);
      } catch (err) {
        errors.push(`${label}/${file.name}: ${(err as Error).message}`);
      }
    }
  };

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    libraries.push(entry.name);
    await scanDir(path.join(root, entry.name), entry.name, 1);
  }

  const observations: Observation[] = IMAGE_SPECS.map((spec) => {
    const bucket = seen.get(spec.file);
    const sizes = [...(bucket?.entries() ?? [])]
      .map(([key, count]) => {
        const [width, height] = key.split("x").map(Number);
        return { width, height, count };
      })
      .sort((a, b) => b.count - a.count);
    const top = sizes[0] ?? null;
    return {
      file: spec.file,
      sizes,
      expected: { width: spec.width, height: spec.height },
      matchesSpec: top
        ? top.width === spec.width && top.height === spec.height
        : null,
    };
  });

  return {
    scannedRoot: root,
    libraries,
    observations,
    metaTemplateHarvestedFrom: metaSource,
    errors,
  };
}
