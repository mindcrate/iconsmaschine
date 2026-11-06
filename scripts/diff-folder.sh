#!/usr/bin/env bash
# Compares the artwork FOLDERS on disk, which diff-product.sh does not - it
# compares database registration. Give it a folder you know displays and one
# that does not:
#
#   ./scripts/diff-folder.sh "bumpin flava" voodoo msxii "moose life"
#
# For each it prints every file with its byte size and real pixel dimensions,
# and the full text of any .meta. A known-good folder next to a broken one
# shows what is missing or malformed, rather than leaving it to inference.
#
# Reads only. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? "/Users/Shared/NI Resources/image";
const names = process.argv.slice(2);
if (names.length === 0) {
  console.log('Usage: ./scripts/diff-folder.sh "bumpin flava" voodoo msxii');
  process.exit(1);
}

/** Pixel size straight from the file header - no image library needed. */
function dims(file: string): string {
  let b: Buffer;
  try {
    b = fs.readFileSync(file);
  } catch {
    return "?";
  }
  // PNG: IHDR is always the first chunk.
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  }
  // WebP: VP8X (extended), VP8L (lossless), VP8 (lossy).
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = b.toString("ascii", 12, 16);
    if (fourcc === "VP8X") {
      return `${(b.readUIntLE(24, 3) & 0xffffff) + 1}x${(b.readUIntLE(27, 3) & 0xffffff) + 1}`;
    }
    if (fourcc === "VP8 ") {
      return `${b.readUInt16LE(26) & 0x3fff}x${b.readUInt16LE(28) & 0x3fff}`;
    }
    if (fourcc === "VP8L") {
      const n = b.readUInt32LE(21);
      return `${(n & 0x3fff) + 1}x${((n >> 14) & 0x3fff) + 1}`;
    }
    return "webp";
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  return "?";
}

const walk = (dir: string, depth = 0): string[] => {
  let out: string[] = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".") && e.name !== ".meta") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 2) out = out.concat(walk(p, depth + 1));
    else if (e.isFile()) out.push(p);
  }
  return out;
};

for (const name of names) {
  const dir = path.join(imageDir, name);
  console.log("=".repeat(74));
  console.log(`image/${name}/`);
  console.log("=".repeat(74));
  if (!fs.existsSync(dir)) {
    console.log("  DOES NOT EXIST\n");
    continue;
  }
  const files = walk(dir);
  if (files.length === 0) console.log("  EMPTY - no files at all");
  for (const f of files) {
    const rel = path.relative(dir, f);
    const size = fs.statSync(f).size;
    const d = /\.(png|webp|jpe?g)$/i.test(f) ? dims(f) : "";
    console.log(`  ${rel.padEnd(36)} ${String(size).padStart(8)} B  ${d}`);
  }
  for (const f of files) {
    if (!/(^|\/|\\)\.?meta$|\.meta$/i.test(f)) continue;
    console.log(`\n  --- ${path.relative(dir, f)} ---`);
    try {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) console.log("  " + line);
    } catch (e) {
      console.log("  (unreadable: " + String(e) + ")");
    }
  }
  console.log();
}
NODE
