import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Points both NI trees at a scratch dir for the duration of one test. */
async function tempRoot(t: { after: (fn: () => unknown) => void }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-ni-"));
  const image = path.join(base, "image");
  await fs.mkdir(image, { recursive: true });
  process.env.NI_RESOURCES_IMAGE_DIR = image;
  t.after(async () => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, image, distDb: path.join(base, "dist_database") };
}

const files = [
  { file: "MST_artwork.png", buffer: Buffer.from("artwork"), width: 134, height: 66 },
  { file: "VB_artwork.png", buffer: Buffer.from("vb"), width: 96, height: 47 },
];

const DISTDB = {
  vendor: "FutureAudioWorkshop",
  product: "SubLab",
  fileType: "Instruments",
  categories: ["Synthesizers"],
  bgColor: "f4b021",
  shortName: null,
};

test("an image-only pack writes artwork plus a generated image .meta", async (t) => {
  const { image } = await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");

  const input = {
    product: "Amplified Funk",
    vendor: "",
    files,
    distDb: null,
  };

  const plan = await planInstall(input);
  assert.equal(plan.rootExists, true);
  assert.equal(plan.rootWritable, true);
  assert.equal(plan.distDbDir, null);
  assert.equal(plan.writes.length, 3, "two images plus the .meta");
  assert.ok(plan.writes.every((w) => w.tree === "image"));

  await install(input);

  // Folder is lowercased; the XML inside keeps the display casing.
  const dir = path.join(image, "amplified funk");
  const meta = await fs.readFile(path.join(dir, "amplified funk.meta"), "utf8");
  assert.ok(meta.includes("<name>Amplified Funk</name>"));
  assert.ok(meta.includes("<type>image</type>"));
  assert.equal(meta.includes("<vendor>"), false);
  assert.equal(await fs.readFile(path.join(dir, "MST_artwork.png"), "utf8"), "artwork");
});

test("a plugin pack writes both trees, nesting dist_database by vendor", async (t) => {
  const { image, distDb } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  const result = await install({
    product: "SubLab",
    vendor: "FutureAudioWorkshop",
    files,
    distDb: DISTDB,
  });

  // image/ is FLAT - product only, no vendor folder.
  await fs.access(path.join(image, "sublab", "MST_artwork.png"));
  await fs.access(path.join(image, "sublab", "sublab.meta"));
  assert.equal(
    await fs
      .access(path.join(image, "futureaudioworkshop"))
      .then(() => true)
      .catch(() => false),
    false,
    "image/ must not be nested by vendor",
  );

  // dist_database/ IS nested.
  const dd = path.join(distDb, "futureaudioworkshop", "sublab");
  for (const f of ["categories.json", "color.json", "shortname.json", "sublab.meta"]) {
    await fs.access(path.join(dd, f));
  }

  const cats = JSON.parse(await fs.readFile(path.join(dd, "categories.json"), "utf8"));
  assert.equal(cats.Vendor, "FutureAudioWorkshop");
  assert.equal(cats.CategoryDB[0].Categories[0], "Synthesizers");

  const meta = await fs.readFile(path.join(dd, "sublab.meta"), "utf8");
  assert.ok(meta.includes("<vendor>FutureAudioWorkshop</vendor>"));
  assert.ok(meta.includes("<type>dist_database</type>"));

  assert.equal(result.written.length, 7);
  assert.ok(result.distDbDir);
});

test("the two .meta files are not interchangeable", async (t) => {
  const { image, distDb } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");
  await install({
    product: "SubLab",
    vendor: "FutureAudioWorkshop",
    files,
    distDb: DISTDB,
  });

  const imageMeta = await fs.readFile(path.join(image, "sublab", "sublab.meta"), "utf8");
  const ddMeta = await fs.readFile(
    path.join(distDb, "futureaudioworkshop", "sublab", "sublab.meta"),
    "utf8",
  );
  assert.notEqual(imageMeta, ddMeta);
  assert.ok(imageMeta.includes("<type>image</type>"));
  assert.ok(ddMeta.includes("<type>dist_database</type>"));
});

test("a second install reports the files it would overwrite", async (t) => {
  await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");
  const input = { product: "Exhale", vendor: "", files, distDb: null };

  await install(input);
  const plan = await planInstall(input);
  assert.ok(
    plan.writes.every((w) => w.existing !== null),
    "every write should be flagged as an overwrite",
  );
});

test("install refuses names that climb out of the root", async (t) => {
  await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await assert.rejects(
    () => install({ product: "..", vendor: "", files, distDb: null }),
    /Invalid folder name/,
  );
  await assert.rejects(
    () =>
      install({
        product: "../../escape",
        vendor: "",
        files,
        distDb: null,
      }),
    /path separators/,
  );
  await assert.rejects(
    () =>
      install({
        product: "Fine",
        vendor: "x",
        files,
        distDb: { ...DISTDB, vendor: "../../escape" },
      }),
    /path separators/,
  );
});

test("planInstall reports a missing root instead of throwing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-gone-"));
  await fs.rm(dir, { recursive: true, force: true });
  process.env.NI_RESOURCES_IMAGE_DIR = path.join(dir, "image");
  t.after(() => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
  });

  const { planInstall } = await import("../src/lib/install.ts");
  const plan = await planInstall({
    product: "Blap Kit",
    vendor: "",
    files,
    distDb: null,
  });
  assert.equal(plan.rootExists, false);
  assert.ok(plan.warnings.some((w) => w.includes("does not exist")));
});

test("image-only packs warn that a Vendor property is still required", async (t) => {
  await tempRoot(t);
  const { planInstall } = await import("../src/lib/install.ts");
  const plan = await planInstall({
    product: "Blap Kit",
    vendor: "",
    files,
    distDb: null,
  });
  assert.ok(
    plan.warnings.some((w) => w.includes("Vendor property")),
    `expected the vendor caveat, got ${JSON.stringify(plan.warnings)}`,
  );
});
