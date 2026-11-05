import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeJoin } from "../src/lib/paths.ts";
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

test("zipPack lays out both trees ready to unzip over NI Resources", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-zip-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from("fake png bytes \u00ff\u00fe", "utf8");
  const zip = zipPack({
    product: "SubLab",
    files: [
      { file: "MST_artwork.png", buffer: payload, width: 134, height: 66 },
      { file: "VB_artwork.png", buffer: payload, width: 96, height: 47 },
    ],
    distDb: {
      vendor: "FutureAudioWorkshop",
      product: "SubLab",
      fileType: "Instruments",
      categories: ["Synthesizers"],
      bgColor: "f4b021",
      shortName: null,
    },
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
    print(n)`,
    zipPath,
  ]);

  assert.deepEqual(stdout.trim().split("\n"), [
    "dist_database/futureaudioworkshop/sublab/categories.json",
    "dist_database/futureaudioworkshop/sublab/color.json",
    "dist_database/futureaudioworkshop/sublab/shortname.json",
    "dist_database/futureaudioworkshop/sublab/sublab.meta",
    "image/sublab/MST_artwork.png",
    "image/sublab/VB_artwork.png",
    "image/sublab/sublab.meta",
  ]);
});

test("an image-only pack zips without a dist_database tree", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-zip2-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const zip = zipPack({
    product: "Amplified Funk",
    files: [{ file: "MST_logo.png", buffer: Buffer.from("x"), width: 1, height: 1 }],
    distDb: null,
  });
  const zipPath = path.join(dir, "p.zip");
  await fs.writeFile(zipPath, zip);

  const { stdout } = await run("python3", [
    "-c",
    `import zipfile,sys; print("\\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))`,
    zipPath,
  ]);
  assert.deepEqual(stdout.trim().split("\n"), [
    "image/amplified funk/MST_logo.png",
    "image/amplified funk/amplified funk.meta",
  ]);
});
