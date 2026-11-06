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

test("a plugin pack nests by vendor in BOTH trees", async (t) => {
  const { image, distDb } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  const result = await install({
    product: "SubLab",
    vendor: "FutureAudioWorkshop",
    files,
    distDb: DISTDB,
  });

  // Confirmed against a real system: image/futureaudioworkshop/sublab/
  const img = path.join(image, "futureaudioworkshop", "sublab");
  await fs.access(path.join(img, "MST_artwork.png"));
  await fs.access(path.join(img, "sublab.meta"));

  // A plugin must NOT land flat at the top of image/.
  assert.equal(
    await fs
      .access(path.join(image, "sublab"))
      .then(() => true)
      .catch(() => false),
    false,
    "plugin image folder must be nested under the vendor",
  );

  const dd = path.join(distDb, "futureaudioworkshop", "sublab");
  for (const f of ["categories.json", "color.json", "shortname.json", "sublab.meta"]) {
    await fs.access(path.join(dd, f));
  }

  const cats = JSON.parse(await fs.readFile(path.join(dd, "categories.json"), "utf8"));
  assert.equal(cats.Vendor, "FutureAudioWorkshop");
  assert.equal(cats.CategoryDB[0].Categories[0], "Synthesizers");

  assert.equal(result.written.length, 7);
  assert.ok(result.distDbDir);
});

test("an expansion stays flat in image/, matching 'amplified funk'", async (t) => {
  const { image } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await install({
    product: "Amplified Funk",
    vendor: "",
    files,
    distDb: null,
  });

  await fs.access(path.join(image, "amplified funk", "MST_artwork.png"));
  await fs.access(path.join(image, "amplified funk", "amplified funk.meta"));
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

  const imageMeta = await fs.readFile(
    path.join(image, "futureaudioworkshop", "sublab", "sublab.meta"),
    "utf8",
  );
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

test("uninstall removes only this app's files and prunes empty folders", async (t) => {
  const { image, distDb } = await tempRoot(t);
  const { install, uninstall } = await import("../src/lib/install.ts");
  const input = {
    product: "SubLab",
    vendor: "FutureAudioWorkshop",
    files,
    distDb: DISTDB,
  };

  await install(input);
  const result = await uninstall(input);

  assert.equal(result.removed.length, 7);
  assert.equal(result.keptFolders.length, 0);
  // Both vendor folders should be gone, not just the leaves.
  for (const p of [
    path.join(image, "futureaudioworkshop"),
    path.join(distDb, "futureaudioworkshop"),
  ]) {
    assert.equal(
      await fs.access(p).then(() => true).catch(() => false),
      false,
      `${p} should have been pruned`,
    );
  }
});

test("uninstall refuses to delete a folder holding files it did not write", async (t) => {
  const { image } = await tempRoot(t);
  const { install, uninstall } = await import("../src/lib/install.ts");
  const input = { product: "Amplified Funk", vendor: "", files, distDb: null };

  await install(input);
  // Something precious that this app never created.
  const stranger = path.join(image, "amplified funk", "NOT_OURS.png");
  await fs.writeFile(stranger, "keep me");

  const result = await uninstall(input);

  await fs.access(stranger); // still there
  assert.equal(await fs.readFile(stranger, "utf8"), "keep me");
  assert.ok(
    result.keptFolders.some((k) => k.includes("amplified funk")),
    `expected the folder to be reported as kept, got ${JSON.stringify(result.keptFolders)}`,
  );
});

test("uninstall is a no-op when nothing is installed", async (t) => {
  await tempRoot(t);
  const { uninstall } = await import("../src/lib/install.ts");
  const result = await uninstall({
    product: "Never Installed",
    vendor: "",
    files,
    distDb: null,
  });
  assert.deepEqual(result.removed, []);
});

const PREV = { vendor: "Xfer Records", product: "Serum", distDb: true };

test("renaming a pack is reported as leaving the old folders behind", async (t) => {
  const { image } = await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");

  // Installed once under the old name.
  await install({
    product: "Serum",
    vendor: "Xfer Records",
    files,
    distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum" },
  });

  // Now renamed.
  const plan = await planInstall({
    product: "Serum 2",
    vendor: "Xfer Records",
    files,
    distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum 2" },
    previous: PREV,
  });

  assert.equal(plan.staleDirs.length, 2, "both trees' old folders are stale");
  assert.ok(plan.staleDirs.some((d) => d.includes(path.join("image", "xfer records", "serum"))));
  assert.ok(plan.warnings.some((w) => w.includes("last installed as")));
  assert.ok(await fs.access(path.join(image, "xfer records", "serum")).then(() => true));
});

test("installing after a rename cleans the old folders up", async (t) => {
  const { image, distDb } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await install({
    product: "Serum",
    vendor: "Xfer Records",
    files,
    distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum" },
  });

  const result = await install(
    {
      product: "Serum 2",
      vendor: "Xfer Records",
      files,
      distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum 2" },
      previous: PREV,
    },
    { cleanStale: true },
  );

  assert.equal(result.cleaned.length, 2);
  // New location written...
  await fs.access(path.join(image, "xfer records", "serum 2", "MST_artwork.png"));
  await fs.access(path.join(distDb, "xfer records", "serum 2", "categories.json"));
  // ...old location gone.
  for (const gone of [
    path.join(image, "xfer records", "serum"),
    path.join(distDb, "xfer records", "serum"),
  ]) {
    assert.equal(
      await fs.access(gone).then(() => true).catch(() => false),
      false,
      `${gone} should have been cleaned up`,
    );
  }
});

test("a rename never deletes a folder holding someone else's files", async (t) => {
  const { image } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await install({
    product: "Serum",
    vendor: "Xfer Records",
    files,
    distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum" },
  });

  const stranger = path.join(image, "xfer records", "serum", "SOMETHING_ELSE.png");
  await fs.writeFile(stranger, "not ours");

  const result = await install(
    {
      product: "Serum 2",
      vendor: "Xfer Records",
      files,
      distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum 2" },
      previous: PREV,
    },
    { cleanStale: true },
  );

  await fs.access(stranger);
  assert.equal(await fs.readFile(stranger, "utf8"), "not ours");
  assert.equal(
    result.cleaned.includes(path.join(image, "xfer records", "serum")),
    false,
    "a folder with foreign files must not be reported as cleaned",
  );
});

test("reinstalling under the same name reports nothing stale", async (t) => {
  await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");
  const input = {
    product: "Serum",
    vendor: "Xfer Records",
    files,
    distDb: { ...DISTDB, vendor: "Xfer Records", product: "Serum" },
    previous: PREV,
  };
  await install(input);
  const plan = await planInstall(input);
  assert.deepEqual(plan.staleDirs, []);
  assert.ok(plan.writes.every((w) => w.existing !== null), "all files overwrite");
});

test("a user sample pack nests under its vendor with no dist_database entry", async (t) => {
  const { image } = await tempRoot(t);
  const { planInstall, install } = await import("../src/lib/install.ts");

  // The layout measured on a real system: image/moose life/ holds no files of
  // its own, only ALL BREAKS/, VOCALS/, VOODOO/ and the rest, each with its
  // own set and .meta. This is what the original app produced and what my
  // flat image/voodoo/ did not.
  const input = {
    product: "Voodoo",
    vendor: "Moose Life",
    files: [{ file: "MST_artwork.png", buffer: Buffer.from("a") }],
    distDb: null,
    imageVendor: "Moose Life",
  };

  const plan = await planInstall(input);
  assert.equal(plan.imageDir.endsWith(path.join("image", "moose life", "voodoo")), true);
  // Nesting must not drag a dist_database entry along with it.
  assert.equal(plan.distDbDir, null);
  assert.equal(
    plan.writes.some((w) => w.tree === "dist_database"),
    false,
  );

  await install(input);
  assert.deepEqual(
    (await fs.readdir(path.join(image, "moose life", "voodoo"))).sort(),
    ["MST_artwork.png", "voodoo.meta"],
  );
  // And nothing at the flat location, which is the expansion layout.
  await assert.rejects(() => fs.stat(path.join(image, "voodoo")));
});

test("renaming out of a nested layout leaves the old folder flagged", async (t) => {
  const { image } = await tempRoot(t);
  // The stale folder must exist to be reported.
  await fs.mkdir(path.join(image, "moose life", "voodoo"), { recursive: true });
  await fs.writeFile(path.join(image, "moose life", "voodoo", "MST_artwork.png"), "a");
  const { planInstall } = await import("../src/lib/install.ts");

  const plan = await planInstall({
    product: "Voodoo",
    vendor: "Moose Life",
    files: [{ file: "MST_artwork.png", buffer: Buffer.from("a") }],
    distDb: null,
    imageVendor: null,
    previous: { vendor: "Moose Life", product: "Voodoo", distDb: false, nested: true },
  });

  // Same names, different shape: the nested folder is now orphaned.
  assert.equal(plan.staleDirs.length, 1);
  assert.equal(
    plan.staleDirs[0].endsWith(path.join("image", "moose life", "voodoo")),
    true,
  );
});
