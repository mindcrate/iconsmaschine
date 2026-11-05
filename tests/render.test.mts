import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderOne, renderPack } from "../src/lib/render.ts";
import { IMAGE_SPECS, specsFor, validateFolderName } from "../src/lib/spec.ts";

/** A tall, obviously non-matching source so cropping/fitting is exercised. */
async function source(w = 1600, h = 900) {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 200, g: 60, b: 20, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

test("every spec renders at exactly its declared dimensions", async () => {
  const src = await source();
  for (const spec of IMAGE_SPECS) {
    const out = await renderOne(src, spec, { padding: 0.1 });
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, spec.width, `${spec.file} width`);
    assert.equal(meta.height, spec.height, `${spec.file} height`);
    assert.equal(
      meta.format,
      spec.format === "webp" ? "webp" : "png",
      `${spec.file} format`,
    );
  }
});

test("dimensions hold for extreme source aspect ratios", async () => {
  for (const [w, h] of [
    [4000, 100],
    [100, 4000],
    [64, 64],
    [1, 1],
  ]) {
    const src = await source(w, h);
    for (const spec of IMAGE_SPECS) {
      const out = await renderOne(src, spec, { padding: 0.25 });
      const meta = await sharp(out).metadata();
      assert.equal(meta.width, spec.width, `${spec.file} from ${w}x${h}`);
      assert.equal(meta.height, spec.height, `${spec.file} from ${w}x${h}`);
    }
  }
});

test("contain fit keeps the whole logo, cover fit fills the frame", async () => {
  // A source with a distinct border; `contain` must preserve both edges.
  const src = await sharp({
    create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const contain = IMAGE_SPECS.find((s) => s.fit === "contain")!;
  const out = await renderOne(src, contain, { padding: 0, background: null });
  const { width, height } = await sharp(out).metadata();
  assert.equal(width, contain.width);
  assert.equal(height, contain.height);
});

test("opaque background flattens away transparency", async () => {
  const src = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const spec = IMAGE_SPECS.find((s) => s.fit === "contain")!;
  const out = await renderOne(src, spec, { background: "#ff8800" });
  const stats = await sharp(out).stats();
  assert.equal(stats.isOpaque, true);
});

test("nks2 files are excluded unless requested", () => {
  assert.equal(specsFor({ nks2: false }).some((s) => s.nks2), false);
  assert.equal(specsFor({ nks2: true }).some((s) => s.nks2), true);
  assert.equal(specsFor({ nks2: true }).length, IMAGE_SPECS.length);
});

test("renderPack routes logo files to the logo source when present", async () => {
  const artwork = await source(1200, 1200);
  const logo = await sharp({
    create: { width: 600, height: 200, channels: 4, background: { r: 10, g: 240, b: 10, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const withLogo = await renderPack({ artwork, logo }, specsFor({ nks2: true }), {
    padding: 0,
    background: null,
  });
  assert.equal(withLogo.length, IMAGE_SPECS.length);

  const withoutLogo = await renderPack(
    { artwork, logo: null },
    specsFor({ nks2: true }),
    { padding: 0, background: null },
  );

  /**
   * Channel means rather than `dominant`: a logo is fitted with padding, so the
   * padded canvas can out-vote the logo itself in a dominant-colour histogram.
   * Means stay meaningful whatever the box's aspect ratio.
   */
  const greenness = async (buffer: Buffer) => {
    const { channels } = await sharp(buffer).stats();
    return channels[1].mean - channels[0].mean;
  };

  for (const spec of IMAGE_SPECS) {
    const a = withLogo.find((f) => f.file === spec.file)!;
    const b = withoutLogo.find((f) => f.file === spec.file)!;
    if (spec.source === "logo") {
      assert.ok(
        (await greenness(a.buffer)) > 0,
        `${spec.file} should come from the green logo`,
      );
      assert.ok(
        (await greenness(b.buffer)) < 0,
        `${spec.file} should fall back to the orange artwork`,
      );
    } else {
      assert.ok(
        (await greenness(a.buffer)) < 0,
        `${spec.file} should always come from the orange artwork`,
      );
    }
  }
});

test("folder names reject the characters NI disallows", () => {
  assert.equal(validateFolderName("Blap Kit"), null);
  assert.equal(validateFolderName("LennarDigital"), null);
  assert.ok(validateFolderName(""));
  assert.ok(validateFolderName("bad/name"));
  assert.ok(validateFolderName("bad_name"));
  assert.ok(validateFolderName("bad@name"));
  assert.ok(validateFolderName("../escape"));
  assert.ok(validateFolderName(".hidden"));
  assert.ok(validateFolderName(" padded "));
});
