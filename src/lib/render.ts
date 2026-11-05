import sharp, { type Sharp } from "sharp";
import type { ImageSpec } from "./spec";

export interface RenderOptions {
  /** Hex background painted behind `contain` fits and transparent sources. */
  background?: string | null;
  /** Extra breathing room around `contain` fits, as a fraction of the box. */
  padding?: number;
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function parseBackground(hex: string | null | undefined) {
  if (!hex) return TRANSPARENT;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return TRANSPARENT;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

/**
 * Render one source image to one spec'd file.
 *
 * `cover` crops to fill the box - right for photographic artwork. `contain`
 * fits the whole image inside and pads it - right for logos, which must not be
 * cropped. Padding is applied by shrinking the fit box, then extending back out
 * to the exact spec size so the output dimensions always match the spec.
 */
export async function renderOne(
  source: Buffer,
  spec: ImageSpec,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const background = parseBackground(opts.background);
  const pad = Math.min(Math.max(opts.padding ?? 0, 0), 0.4);

  let pipeline: Sharp;

  if (spec.fit === "cover") {
    pipeline = sharp(source).resize(spec.width, spec.height, {
      fit: "cover",
      position: "centre",
    });
  } else {
    // sharp applies `extend` after `resize` no matter the call order, and a
    // second `resize()` replaces the first. So: resize once into the padded
    // inner box (fit `contain` pads it to exactly that size), then extend by
    // the margins to land on the spec size exactly.
    const innerW = Math.max(1, Math.round(spec.width * (1 - pad * 2)));
    const innerH = Math.max(1, Math.round(spec.height * (1 - pad * 2)));
    const left = Math.floor((spec.width - innerW) / 2);
    const top = Math.floor((spec.height - innerH) / 2);

    pipeline = sharp(source)
      .resize(innerW, innerH, {
        fit: "contain",
        background,
        position: "centre",
      })
      .extend({
        top,
        bottom: spec.height - innerH - top,
        left,
        right: spec.width - innerW - left,
        background,
      });
  }

  if (background.alpha === 1) {
    pipeline = pipeline.flatten({ background });
  }

  return spec.format === "webp"
    ? pipeline.webp({ quality: 92 }).toBuffer()
    : pipeline.png({ compressionLevel: 9 }).toBuffer();
}

export interface RenderedFile {
  file: string;
  buffer: Buffer;
  width: number;
  height: number;
}

export async function renderPack(
  sources: { artwork: Buffer; logo?: Buffer | null },
  specs: ImageSpec[],
  opts: RenderOptions = {},
): Promise<RenderedFile[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const source =
        spec.source === "logo" && sources.logo ? sources.logo : sources.artwork;
      const buffer = await renderOne(source, spec, opts);
      return { file: spec.file, buffer, width: spec.width, height: spec.height };
    }),
  );
}

export async function probe(buffer: Buffer) {
  const { width, height, format } = await sharp(buffer).metadata();
  return { width: width ?? 0, height: height ?? 0, format: format ?? "unknown" };
}
