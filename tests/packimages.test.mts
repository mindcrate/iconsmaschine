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
