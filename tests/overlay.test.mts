import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DEFAULT_OVERLAY, renderText, normaliseHexColor } from "../src/lib/overlay.ts";
import { renderOne, renderPack } from "../src/lib/render.ts";
import { IMAGE_SPECS, specsFor } from "../src/lib/spec.ts";

const FONT = "DejaVu Sans";

async function artwork(w = 1400, h = 1400) {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 200, g: 120, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

test("text never overflows its box, however long the string", async () => {
  // The bug this guards: an estimated glyph width let "MASCHINE KITS"
  // overflow a 240px box and get clipped at the edge.
  const strings = ["M", "MASCHINE KITS", "A VERY LONG SAMPLE PACK NAME INDEED", "WWWWWWWWWWWW"];
  const boxes = [
    [240, 196],
    [227, 47],
    [417, 65],
    [1280, 212],
    [96, 47],
  ];

  for (const text of strings) {
    for (const [w, h] of boxes) {
      const t = await renderText({ ...DEFAULT_OVERLAY, text, font: FONT }, w, h);
      assert.ok(t, `nothing rendered for ${JSON.stringify(text)} in ${w}x${h}`);
      assert.ok(t.width <= w, `${text} too wide in ${w}x${h}: ${t.width}`);
      assert.ok(t.height <= h, `${text} too tall in ${w}x${h}: ${t.height}`);
      assert.ok(t.left >= 0 && t.left + t.width <= w, `${text} overflows horizontally in ${w}x${h}`);
      assert.ok(t.top >= 0 && t.top + t.height <= h, `${text} overflows vertically in ${w}x${h}`);
    }
  }
});

test("alignment positions the text where it says", async () => {
  const base = { ...DEFAULT_OVERLAY, text: "KITS", font: FONT, sizePct: 0.4 };
  const [w, h] = [400, 100];

  const left = (await renderText({ ...base, align: "left" }, w, h))!;
  const centre = (await renderText({ ...base, align: "centre" }, w, h))!;
  const right = (await renderText({ ...base, align: "right" }, w, h))!;

  assert.ok(left.left < centre.left, "left should sit before centre");
  assert.ok(centre.left < right.left, "centre should sit before right");
  assert.ok(right.left + right.width <= w);
});

test("empty text draws nothing", async () => {
  assert.equal(await renderText({ ...DEFAULT_OVERLAY, text: "   ", font: FONT }, 200, 50), null);
});

test("an unresolvable font name fails soft instead of crashing", async () => {
  // A missing font renders blank glyphs; that must not throw or produce a
  // mystery blank layer baked into the pack.
  const t = await renderText(
    { ...DEFAULT_OVERLAY, text: "KITS", font: "NoSuchFontExists-ZZZ" },
    400,
    100,
  );
  // Either a real fallback font rendered, or nothing did - both are fine, a
  // crash is not.
  if (t) assert.ok(t.width > 0 && t.width <= 400);
});

test("an overlaid file still lands on the exact spec size", async () => {
  const art = await artwork();
  for (const spec of IMAGE_SPECS) {
    const out = await renderOne(art, spec, {
      padding: 0.08,
      overlay: { ...DEFAULT_OVERLAY, text: "MASCHINE KITS", font: FONT, files: [spec.file] },
    });
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, spec.width, `${spec.file} width`);
    assert.equal(meta.height, spec.height, `${spec.file} height`);
  }
});

test("background opacity dims the artwork behind the text", async () => {
  const art = await artwork();
  const spec = IMAGE_SPECS.find((s) => s.file === "NKS2_hardware_banner.webp")!;

  const over = (backgroundOpacity: number) =>
    renderOne(art, spec, {
      overlay: {
        ...DEFAULT_OVERLAY,
        text: "X",
        font: FONT,
        backgroundColor: "#000000",
        backgroundOpacity,
        files: [spec.file],
      },
    });
  const bright = await over(1);
  const dim = await over(0.2);

  const mean = async (b: Buffer) => {
    const st = await sharp(b).stats();
    return (st.channels[0].mean + st.channels[1].mean + st.channels[2].mean) / 3;
  };
  assert.ok((await mean(dim)) < (await mean(bright)), "lower opacity should be darker");
});

test("a background colour replaces the artwork underneath", async () => {
  const art = await artwork();
  const spec = IMAGE_SPECS.find((s) => s.file === "OSO_logo.png")!;
  const out = await renderOne(art, spec, {
    overlay: {
      ...DEFAULT_OVERLAY,
      text: "",
      font: FONT,
      backgroundOpacity: 0,
      backgroundColor: "#0000ff",
      files: [spec.file],
    },
  });
  const st = await sharp(out).stats();
  assert.ok(st.channels[2].mean > 200, "blue channel should dominate");
  assert.ok(st.channels[0].mean < 60, "red should be gone");
});

test("the overlay applies only to the files it names", async () => {
  const art = await artwork();
  const specs = specsFor({ nks2: true });
  const target = "VB_logo.png";

  const files = await renderPack({ artwork: art }, specs, {
    padding: 0.08,
    overlay: {
      ...DEFAULT_OVERLAY,
      text: "KITS",
      font: FONT,
      backgroundOpacity: 0,
      backgroundColor: "#000000",
      files: [target],
    },
  });

  const mean = async (b: Buffer) => {
    const st = await sharp(b).stats();
    return (st.channels[0].mean + st.channels[1].mean + st.channels[2].mean) / 3;
  };

  const overlaid = files.find((f) => f.file === target)!;
  const untouched = files.find((f) => f.file === "MST_artwork.png")!;
  assert.ok(
    (await mean(overlaid.buffer)) < 90,
    "the named file should be blacked out behind the text",
  );
  assert.ok(
    (await mean(untouched.buffer)) > 90,
    "other files must be untouched",
  );
});

test("hex colours are normalised, and nonsense falls back", () => {
  assert.equal(normaliseHexColor("#AABBCC"), "#aabbcc");
  assert.equal(normaliseHexColor("aabbcc"), "#aabbcc");
  assert.equal(normaliseHexColor("not a colour"), "#ffffff");
  assert.equal(normaliseHexColor("nope", "#123456"), "#123456");
});

test("parseOverlay clamps hostile input instead of trusting it", async () => {
  const { parseOverlay, DEFAULT_OVERLAY } = await import("../src/lib/overlay.ts");

  // Nothing to draw is the same as no overlay.
  assert.equal(parseOverlay({ text: "   " }), null);
  assert.equal(parseOverlay(null), null);
  assert.equal(parseOverlay("nope"), null);

  const o = parseOverlay({
    text: "x".repeat(500),
    weight: "heavy",
    align: "justified",
    color: "not a colour",
    sizePct: 99,
    letterSpacing: -9999,
    backgroundOpacity: 7,
    backgroundColor: "#ABCDEF",
    files: [1, "MST_logo.png", null, "OSO_logo.png"],
  })!;

  assert.equal(o.text.length, 200, "text is bounded");
  assert.equal(o.weight, DEFAULT_OVERLAY.weight, "an unknown weight falls back");
  assert.equal(o.align, DEFAULT_OVERLAY.align);
  assert.equal(o.color, DEFAULT_OVERLAY.color, "an unparseable colour falls back");
  assert.equal(o.sizePct, 1, "size is clamped to the box");
  assert.equal(o.letterSpacing, -20);
  assert.equal(o.backgroundOpacity, 1);
  assert.equal(o.backgroundColor, "#abcdef", "hex is normalised to lowercase");
  assert.deepEqual(o.files, ["MST_logo.png", "OSO_logo.png"], "non-strings dropped");
});

test("parseOverlay keeps a transparent background distinct from a colour", async () => {
  const { parseOverlay } = await import("../src/lib/overlay.ts");
  assert.equal(parseOverlay({ text: "a", backgroundColor: null })!.backgroundColor, null);
  assert.equal(parseOverlay({ text: "a" })!.backgroundColor, null);
  assert.equal(parseOverlay({ text: "a", backgroundColor: "#112233" })!.backgroundColor, "#112233");
});
