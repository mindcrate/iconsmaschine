import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function tempRoot(t: { after: (fn: () => unknown) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-ni-"));
  process.env.NI_RESOURCES_IMAGE_DIR = dir;
  t.after(async () => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

const files = [
  { file: "MST_artwork.png", buffer: Buffer.from("artwork"), width: 134, height: 66 },
  { file: "VB_artwork.png", buffer: Buffer.from("vb"), width: 96, height: 47 },
];

test("install writes the pack into the vendor folder", async (t) => {
  const root = await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");

  const input = { vendor: "Blap Kit", subfolder: null, files, writeMeta: true };

  const plan = await planInstall(input);
  assert.equal(plan.rootExists, true);
  assert.equal(plan.rootWritable, true);
  assert.equal(plan.writes.length, 3, "two images plus the .meta");
  assert.ok(plan.writes.every((w) => w.existing === null), "nothing exists yet");

  const result = await install(input);
  assert.equal(
    await fs.readFile(path.join(root, "Blap Kit", "MST_artwork.png"), "utf8"),
    "artwork",
  );
  await fs.access(path.join(root, "Blap Kit", "Blap Kit.meta"));
  assert.equal(result.written.length, 3);
});

test("plugin packs nest under the vendor, with the .meta at vendor level", async (t) => {
  const root = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await install({
    vendor: "Sugar Bytes",
    subfolder: "Looperator",
    files,
    writeMeta: true,
  });

  await fs.access(path.join(root, "Sugar Bytes", "Looperator", "MST_artwork.png"));
  await fs.access(path.join(root, "Sugar Bytes", "Sugar Bytes.meta"));
});

test("a second install reports the files it would overwrite", async (t) => {
  const root = await tempRoot(t);
  const { install, planInstall } = await import("../src/lib/install.ts");
  const input = { vendor: "Exhale", subfolder: null, files, writeMeta: false };

  await install(input);
  const plan = await planInstall(input);
  assert.equal(plan.writes.length, 2);
  assert.ok(
    plan.writes.every((w) => w.existing !== null),
    "every write should be flagged as an overwrite",
  );
  assert.equal(path.resolve(plan.targetDir), path.resolve(root, "Exhale"));
});

test("install refuses folder names that climb out of the root", async (t) => {
  await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");

  await assert.rejects(
    () => install({ vendor: "..", subfolder: null, files, writeMeta: false }),
    /Invalid folder name/,
  );
  await assert.rejects(
    () =>
      install({
        vendor: "Vendor",
        subfolder: "../../escape",
        files,
        writeMeta: false,
      }),
    /path separators/,
  );
});

test("planInstall reports a missing root instead of throwing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-gone-"));
  await fs.rm(dir, { recursive: true, force: true });
  process.env.NI_RESOURCES_IMAGE_DIR = dir;
  t.after(() => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
  });

  const { planInstall } = await import("../src/lib/install.ts");
  const plan = await planInstall({
    vendor: "Blap Kit",
    subfolder: null,
    files,
    writeMeta: false,
  });
  assert.equal(plan.rootExists, false);
  assert.equal(plan.rootWritable, false);
  assert.ok(plan.warnings.some((w) => w.includes("does not exist")));
});

test("warns when the harvested .meta still carries the donor library's name", async (t) => {
  const root = await tempRoot(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-home-"));
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });

  const { saveMetaTemplate } = await import("../src/lib/meta.ts");
  const { planInstall } = await import("../src/lib/install.ts");

  // A template harvested from "Abbey Road 60s Drummer" that embeds that name.
  await saveMetaTemplate(
    Buffer.from("NIKS\u0001\u0000Abbey Road 60s Drummer\u0000", "binary"),
    "Abbey Road 60s Drummer",
  );

  const plan = await planInstall({
    vendor: "Blap Kit",
    subfolder: null,
    files,
    writeMeta: true,
  });

  assert.ok(
    plan.warnings.some((w) => w.includes("Abbey Road 60s Drummer")),
    `expected a foreign-name warning, got: ${JSON.stringify(plan.warnings)}`,
  );
  assert.ok(path.resolve(plan.targetDir).startsWith(path.resolve(root)));
});

test("no foreign-name warning when the template has no embedded name", async (t) => {
  await tempRoot(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-home2-"));
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });

  const { saveMetaTemplate } = await import("../src/lib/meta.ts");
  const { planInstall } = await import("../src/lib/install.ts");

  await saveMetaTemplate(Buffer.from("opaque binary blob"), "Some Library");

  const plan = await planInstall({
    vendor: "Blap Kit",
    subfolder: null,
    files,
    writeMeta: true,
  });
  assert.equal(
    plan.warnings.some((w) => w.includes("Some Library")),
    false,
  );
});
