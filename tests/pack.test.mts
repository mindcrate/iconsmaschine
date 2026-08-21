import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeJoin, packSegments } from "../src/lib/paths.ts";
import { zipPack } from "../src/lib/zip.ts";

const run = promisify(execFile);

test("safeJoin refuses to escape the root", () => {
  const root = "/tmp/root";
  assert.equal(safeJoin(root, "Blap Kit"), "/tmp/root/Blap Kit");
  assert.equal(safeJoin(root, "Vendor", "Plugin"), "/tmp/root/Vendor/Plugin");

  for (const bad of ["..", ".", "", "../etc", "a/b", "a\\b", "a\0b"]) {
    assert.throws(() => safeJoin(root, bad), `expected ${JSON.stringify(bad)} to throw`);
  }
});

test("packSegments nests only when a subfolder is given", () => {
  assert.deepEqual(packSegments("Vendor", null), ["Vendor"]);
  assert.deepEqual(packSegments("Vendor", "   "), ["Vendor"]);
  assert.deepEqual(packSegments("Vendor", " Plugin "), ["Vendor", "Plugin"]);
});

test("zipPack produces an archive the system unzip accepts", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-zip-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from("fake png bytes ÿþ", "utf8");
  const zip = zipPack({
    vendor: "Sugar Bytes",
    subfolder: "Looperator",
    files: [
      { file: "MST_artwork.png", buffer: payload, width: 134, height: 66 },
      { file: "VB_artwork.png", buffer: payload, width: 96, height: 47 },
    ],
    meta: Buffer.from("meta contents"),
  });

  const zipPath = path.join(dir, "pack.zip");
  await fs.writeFile(zipPath, zip);

  // Validate with a real unzip implementation rather than our own reader.
  const { stdout } = await run("python3", [
    "-c",
    `import zipfile,sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "bad crc"
for n in sorted(z.namelist()):
    print(n, len(z.read(n)))`,
    zipPath,
  ]);

  const lines = stdout.trim().split("\n");
  assert.deepEqual(lines, [
    `Sugar Bytes/Looperator/MST_artwork.png ${payload.length}`,
    `Sugar Bytes/Looperator/VB_artwork.png ${payload.length}`,
    `Sugar Bytes/Sugar Bytes.meta 13`,
  ]);
});

test("zipPack puts files at the vendor root when there is no subfolder", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-zip2-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const zip = zipPack({
    vendor: "Blap Kit",
    subfolder: null,
    files: [{ file: "MST_logo.png", buffer: Buffer.from("x"), width: 1, height: 1 }],
    meta: null,
  });
  const zipPath = path.join(dir, "p.zip");
  await fs.writeFile(zipPath, zip);

  const { stdout } = await run("python3", [
    "-c",
    `import zipfile,sys; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))`,
    zipPath,
  ]);
  assert.equal(stdout.trim(), "Blap Kit/MST_logo.png");
});
