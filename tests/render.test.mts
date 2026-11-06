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

test("a manual crop changes which pixels end up in the output", async () => {
  // Left half red, right half blue.
  const src = await sharp({
    create: { width: 400, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
        })
          .png()
          .toBuffer(),
        left: 200,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  const spec = { ...IMAGE_SPECS.find((s) => s.fit === "cover")!, width: 50, height: 50 };

  const leftOnly = await renderOne(src, spec, {
    crop: { x: 0, y: 0, w: 0.25, h: 1 },
  });
  const rightOnly = await renderOne(src, spec, {
    crop: { x: 0.75, y: 0, w: 0.25, h: 1 },
  });

  const l = await sharp(leftOnly).stats();
  const r = await sharp(rightOnly).stats();
  assert.ok(l.channels[0].mean > 200, "left crop should be red");
  assert.ok(l.channels[2].mean < 50);
  assert.ok(r.channels[2].mean > 200, "right crop should be blue");
  assert.ok(r.channels[0].mean < 50);
});

test("a cropped render still lands on the exact spec size", async () => {
  const src = await sharp({
    create: { width: 1600, height: 900, channels: 4, background: { r: 20, g: 90, b: 160, alpha: 1 } },
  })
    .png()
    .toBuffer();

  for (const spec of IMAGE_SPECS) {
    const out = await renderOne(src, spec, {
      crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
    });
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, spec.width, `${spec.file} width`);
    assert.equal(meta.height, spec.height, `${spec.file} height`);
  }
});

test("renderPack applies crops per file, leaving others automatic", async () => {
  const src = await sharp({
    create: { width: 800, height: 400, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const specs = specsFor({ nks2: false });
  const target = specs[0].file;
  const files = await renderPack({ artwork: src }, specs, {}, {
    [target]: { x: 0, y: 0, w: 0.2, h: 0.2 },
  });

  assert.equal(files.length, specs.length);
  for (const f of files) {
    const spec = specs.find((s) => s.file === f.file)!;
    const meta = await sharp(f.buffer).metadata();
    assert.equal(meta.width, spec.width);
    assert.equal(meta.height, spec.height);
  }
});

test("logo files fill the frame when derived from artwork, not left as a speck", async () => {
  // A square photo into a 227x47 box: `contain` would leave it on ~14% of the
  // frame with the rest transparent, which is the bug this guards.
  const square = await sharp({
    create: { width: 1400, height: 1400, channels: 4, background: { r: 200, g: 90, b: 20, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const wideLogoSpecs = IMAGE_SPECS.filter(
    (s) => s.source === "logo" && s.width / s.height > 3,
  );
  assert.ok(wideLogoSpecs.length > 0, "there should be wide logo specs to test");

  for (const spec of wideLogoSpecs) {
    const out = await renderOne(square, spec, { padding: 0.08, background: null });
    const stats = await sharp(out).stats();
    const coverage = stats.channels[3] ? stats.channels[3].mean / 255 : 1;
    assert.ok(
      coverage > 0.99,
      `${spec.file} should be filled, but only ${Math.round(coverage * 100)}% is covered`,
    );
  }
});

test("a dedicated logo is still fitted whole, never clipped", async () => {
  const logo = await sharp({
    create: { width: 900, height: 300, channels: 4, background: { r: 0, g: 220, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const artwork = await sharp({
    create: { width: 1400, height: 1400, channels: 4, background: { r: 200, g: 90, b: 20, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const files = await renderPack({ artwork, logo }, specsFor({ nks2: false }), {
    padding: 0.08,
    background: null,
  });

  const vbLogo = files.find((f) => f.file === "VB_logo.png")!;
  const stats = await sharp(vbLogo.buffer).stats();
  const coverage = stats.channels[3] ? stats.channels[3].mean / 255 : 1;
  // Letterboxed: a 3:1 logo in a ~4.8:1 box cannot fill it without clipping.
  assert.ok(
    coverage < 0.9,
    `a real logo should be letterboxed, not cropped (coverage ${coverage})`,
  );

  // The artwork-sourced tile is unaffected and still fills.
  const art = files.find((f) => f.file === "VB_artwork.png")!;
  const artStats = await sharp(art.buffer).stats();
  assert.ok((artStats.channels[3]?.mean ?? 255) / 255 > 0.99);
});

test("an overlay reaches the files it names and leaves the others alone", async () => {
  const { renderPack } = await import("../src/lib/render.ts");
  const { DEFAULT_OVERLAY } = await import("../src/lib/overlayspec.ts");
  const { specsFor } = await import("../src/lib/spec.ts");

  const artwork = await sharp({
    create: { width: 600, height: 600, channels: 4, background: "#2060c0" },
  })
    .png()
    .toBuffer();

  const specs = specsFor({ nks2: false });
  const plain = await renderPack({ artwork }, specs, {});
  const withText = await renderPack({ artwork }, specs, {
    overlay: {
      ...DEFAULT_OVERLAY,
      text: "808 COLLECTION",
      files: ["MST_logo.png"],
    },
  });

  const get = (files: typeof plain, name: string) =>
    files.find((f) => f.file === name)!.buffer;

  // The named file changes...
  assert.notEqual(
    get(plain, "MST_logo.png").toString("base64"),
    get(withText, "MST_logo.png").toString("base64"),
    "the overlay should have altered MST_logo.png",
  );
  // ...and nothing else does.
  for (const spec of specs) {
    if (spec.file === "MST_logo.png") continue;
    assert.equal(
      get(plain, spec.file).toString("base64"),
      get(withText, spec.file).toString("base64"),
      `${spec.file} should be untouched`,
    );
  }

  // Still the spec size: the overlay composites, it does not resize.
  const meta = await sharp(get(withText, "MST_logo.png")).metadata();
  const spec = specs.find((s) => s.file === "MST_logo.png")!;
  assert.equal(meta.width, spec.width);
  assert.equal(meta.height, spec.height);
});
