import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

async function tempHome(t: { after: (fn: () => unknown) => void }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-images-"));
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });
  return home;
}

const png = (r: number, g: number, b: number, w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();

async function makePack(id: string, name = "Test Pack") {
  const { savePack } = await import("../src/lib/store.ts");
  const now = new Date().toISOString();
  return savePack(
    {
      id, name, kitType: "sample_kit", vendor: "", product: name, nks2: true,
      background: null, padding: 0.08, fileType: "", categories: [], shortName: null,
      bgColor: "000000", author: "", share: false, tags: [], nestImage: false,
      overlay: null, crops: { "MST_artwork.png": { x: 0, y: 0, w: 0.5, h: 0.5 }, "VB_artwork.png": { x: 0, y: 0, w: 0.5, h: 0.5 } },
      installedAs: null, hasLogo: false, createdAt: now, updatedAt: now,
    },
    { artwork: await png(255, 0, 0) },
  );
}

test("saveImage stores an image once per content and readSources returns per-file images", async (t) => {
  const home = await tempHome(t);
  const { saveImage, readSources } = await import("../src/lib/store.ts");
  await makePack("p1");
  const blue = await png(0, 0, 255);

  const a = await saveImage("p1", blue);
  const b = await saveImage("p1", blue);
  assert.equal(a, b, "same bytes, same id");
  assert.match(a, /^[0-9a-f]{64}$/);
  const stored = (await fs.readdir(path.join(home, "packs", "p1"))).filter((f) => f.startsWith("source-") && f !== "source-artwork.png");
  assert.deepEqual(stored, [`source-${a}.png`]);

  const sources = await readSources("p1", { "NKS2_hardware_banner.webp": a });
  assert.ok(sources.files["NKS2_hardware_banner.webp"].equals(blue));
  assert.ok(sources.artwork);
});

test("readSourceImage accepts artwork, logo and image ids only", async (t) => {
  await tempHome(t);
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");
  assert.ok(await readSourceImage("p1", "artwork"));
  assert.equal(await readSourceImage("p1", "logo"), null, "no logo yet");
  assert.equal(await readSourceImage("p1", "../pack.json"), null);
  assert.equal(await readSourceImage("p1", "pack"), null);
});

test("replacing one file stores its own image and clears only its crop", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");

  const { pack } = await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));
  assert.match(pack.fileSources!["MST_artwork.png"], /^[0-9a-f]{64}$/);
  assert.equal(pack.crops["MST_artwork.png"], undefined);
  assert.ok(pack.crops["VB_artwork.png"], "other crops stay");
});

test("an unknown output file is refused", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");
  await assert.rejects(
    replacePackImage("p1", { kind: "file", file: "../pack.json" }, await png(0, 0, 255)),
    /Unknown output file/,
  );
});

test("replacing the artwork skips files with their own image and clears the others' crops", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");
  await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));
  const green = await png(0, 255, 0);

  const { pack, skipped } = await replacePackImage("p1", { kind: "artwork" }, green);
  assert.deepEqual(skipped, ["MST_artwork.png"]);
  assert.equal(pack.crops["VB_artwork.png"], undefined);
  assert.ok((await readSourceImage("p1", "artwork"))!.equals(green));
});

test("replacing the logo group creates the logo and marks the pack as having one", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");

  const { pack } = await replacePackImage("p1", { kind: "logo" }, await png(0, 255, 0));
  assert.equal(pack.hasLogo, true);
  assert.ok(await readSourceImage("p1", "logo"));
});

test("reverting a file removes its mapping, its crop and the unused image", async (t) => {
  const home = await tempHome(t);
  const { replacePackImage, clearFileImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");
  await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));

  const pack = await clearFileImage("p1", "MST_artwork.png");
  assert.deepEqual(pack.fileSources, {});
  const left = (await fs.readdir(path.join(home, "packs", "p1"))).filter((f) => /^source-[0-9a-f]{64}\.png$/.test(f));
  assert.deepEqual(left, []);
});

test("the library lists each saved image once, across packs", async (t) => {
  await tempHome(t);
  const { listLibrary, replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1", "One");
  await makePack("p2", "Two");
  await replacePackImage("p2", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));

  const images = await listLibrary();
  assert.equal(images.length, 2, "red artwork shared by both packs counts once, plus the blue image");
  for (const img of images) {
    assert.match(img.imageId, /^[0-9a-f]{64}$/);
    assert.ok(img.url.startsWith(`/api/packs/${img.packId}/source?which=`));
  }
});

test("a pack saved by an older version reads back with every field the app uses", async (t) => {
  const home = await tempHome(t);
  const { readPack, listPacks } = await import("../src/lib/store.ts");
  const dir = path.join(home, "packs", "old1");
  await fs.mkdir(dir, { recursive: true });
  // The shape of a real pack made before product, crops and overlay existed.
  await fs.writeFile(
    path.join(dir, "pack.json"),
    JSON.stringify({
      name: "MSXII-Loops-1984", kitType: "sample_kit", vendor: "MSXII-Loops-1984", subfolder: null,
      nks2: true, background: null, padding: 0, author: "DJ", share: true, tags: ["80s"],
      id: "old1", hasLogo: true, createdAt: "2026-11-05T02:11:30.042Z", updatedAt: "2026-11-05T02:11:30.044Z",
    }),
  );

  const pack = (await readPack("old1"))!;
  assert.equal(pack.product, "MSXII-Loops-1984", "product falls back to the pack name");
  assert.deepEqual(pack.crops, {});
  assert.equal(pack.overlay, null);
  assert.equal(pack.nestImage, false);
  assert.equal(pack.installedAs, null);
  assert.equal(pack.shortName, null);
  assert.deepEqual(pack.categories, []);
  assert.equal(pack.fileType, "Instruments");
  assert.equal(pack.bgColor, "000000");
  assert.equal(pack.vendor, "MSXII-Loops-1984", "saved fields are kept");
  assert.equal(pack.padding, 0);
  assert.equal((await listPacks())[0].product, "MSXII-Loops-1984");
});
