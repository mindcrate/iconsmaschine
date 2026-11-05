import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampCrop,
  cropFromView,
  defaultCoverCrop,
  isValidCrop,
  toPixelRect,
  viewFromCrop,
} from "../src/lib/crop.ts";

const close = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} !== ${b}`);

test("default crop matches what a cover render would do", () => {
  // 1800x1200 source into a 1280x212 banner: very wide target, crop vertically.
  const wide = defaultCoverCrop(1800, 1200, 1280, 212);
  close(wide.w, 1, "full width");
  // A 6.04:1 crop taken at full width from a 1.5:1 source is 1.5/6.04 tall.
  close(wide.h, (1800 / 1200) / (1280 / 212), "slice height");
  close(wide.y + wide.h / 2, 0.5, "vertically centred");

  // Same source into a 240x196 near-square: crop horizontally.
  const tall = defaultCoverCrop(1800, 1200, 240, 196);
  close(tall.h, 1, "full height");
  assert.ok(tall.w < 1);
  close(tall.x + tall.w / 2, 0.5, "horizontally centred");

  // Matching aspect ratios crop nothing.
  const exact = defaultCoverCrop(1000, 500, 200, 100);
  assert.deepEqual(exact, { x: 0, y: 0, w: 1, h: 1 });
});

test("default crop survives degenerate inputs", () => {
  assert.deepEqual(defaultCoverCrop(0, 0, 10, 10), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(defaultCoverCrop(100, 100, 0, 5), { x: 0, y: 0, w: 1, h: 1 });
});

test("clamping keeps a crop inside the image", () => {
  const c = clampCrop({ x: -0.5, y: 0.9, w: 0.4, h: 0.4 });
  assert.ok(c.x >= 0 && c.y >= 0);
  assert.ok(c.x + c.w <= 1 + 1e-9);
  assert.ok(c.y + c.h <= 1 + 1e-9);

  // Oversized crops are reduced, never left escaping the frame.
  const big = clampCrop({ x: 0.2, y: 0.2, w: 5, h: 5 });
  assert.deepEqual(big, { x: 0, y: 0, w: 1, h: 1 });
});

test("validation rejects nonsense", () => {
  assert.equal(isValidCrop({ x: 0, y: 0, w: 1, h: 1 }), true);
  assert.equal(isValidCrop({ x: 0, y: 0, w: 0, h: 1 }), false, "zero width");
  assert.equal(isValidCrop({ x: 0.9, y: 0, w: 0.5, h: 1 }), false, "overflows");
  assert.equal(isValidCrop({ x: NaN, y: 0, w: 1, h: 1 }), false);
  assert.equal(isValidCrop(null), false);
  assert.equal(isValidCrop("nope"), false);
});

test("pixel rect stays inside the source and never collapses", () => {
  const r = toPixelRect({ x: 0, y: 0.4, w: 1, h: 0.1 }, 1800, 1200);
  assert.deepEqual(r, { left: 0, top: 480, width: 1800, height: 120 });

  // A crop far smaller than one pixel still yields a usable rect.
  const tiny = toPixelRect({ x: 0.5, y: 0.5, w: 1e-7, h: 1e-7 }, 100, 100);
  assert.ok(tiny.width >= 1 && tiny.height >= 1);
  assert.ok(tiny.left + tiny.width <= 100);
  assert.ok(tiny.top + tiny.height <= 100);

  // An out-of-range crop is pulled back rather than producing a bad extract.
  const over = toPixelRect({ x: 0.95, y: 0.95, w: 0.5, h: 0.5 }, 200, 200);
  assert.ok(over.left + over.width <= 200);
  assert.ok(over.top + over.height <= 200);
});

test("view state round-trips through a crop", () => {
  const [sw, sh, tw, th] = [1800, 1200, 134, 66];
  const original = { zoom: 2.5, centreX: 0.4, centreY: 0.6 };
  const crop = cropFromView(
    original.zoom,
    original.centreX,
    original.centreY,
    sw,
    sh,
    tw,
    th,
  );
  const back = viewFromCrop(crop, sw, sh, tw, th);
  close(back.zoom, original.zoom, "zoom");
  close(back.centreX, original.centreX, "centreX");
  close(back.centreY, original.centreY, "centreY");
});

test("zoom 1 reproduces the default crop exactly", () => {
  const base = defaultCoverCrop(1800, 1200, 240, 196);
  const fromView = cropFromView(1, 0.5, 0.5, 1800, 1200, 240, 196);
  close(fromView.x, base.x);
  close(fromView.w, base.w);
  close(fromView.h, base.h);
});

test("zoom below 1 is clamped, so the crop never exceeds the image", () => {
  const c = cropFromView(0.1, 0.5, 0.5, 1800, 1200, 134, 66);
  assert.ok(c.w <= 1 && c.h <= 1);
  const base = defaultCoverCrop(1800, 1200, 134, 66);
  close(c.w, base.w);
});
