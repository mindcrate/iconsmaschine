import sharp, { type Sharp } from "sharp";
import type { Fit, ImageSpec } from "./spec";
import { toPixelRect, type Crop, type CropMap } from "./crop";

export interface RenderOptions {
  /** Hex background painted behind `contain` fits and transparent sources. */
  background?: string | null;
  /** Extra breathing room around `contain` fits, as a fraction of the box. */
  padding?: number;
  /** A hand-adjusted crop for this file, overriding the automatic framing. */
  crop?: Crop | null;
  /**
   * True when this file is being rendered from a dedicated logo image.
   *
   * `contain` exists to stop a logo being clipped. But when the logo files are
   * derived from the artwork - a photo, with no logo to protect - `contain`
   * just drops a speck into an empty frame: a square source lands on 14% of a
   * 227x47 box and 11% of a 417x65 one. So without a real logo, fill instead.
   */
  haveLogoSource?: boolean;
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

  // A logo spec only earns `contain` when there is an actual logo to protect.
  const fit: Fit =
    spec.fit === "contain" && spec.source === "logo" && !opts.haveLogoSource
      ? "cover"
      : spec.fit;

  let pipeline: Sharp;

  if (opts.crop) {
    // A hand-adjusted crop already carries the target aspect ratio, so `fill`
    // only scales it - no further cropping or letterboxing is wanted.
    const meta = await sharp(source).metadata();
    const rect = toPixelRect(opts.crop, meta.width ?? 1, meta.height ?? 1);
    pipeline = sharp(source)
      .extract(rect)
      .resize(spec.width, spec.height, { fit: "fill" });
  } else if (fit === "cover") {
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
  crops: CropMap = {},
): Promise<RenderedFile[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const useLogo = spec.source === "logo" && Boolean(sources.logo);
      const source = useLogo ? sources.logo! : sources.artwork;
      const buffer = await renderOne(source, spec, {
        ...opts,
        crop: crops[spec.file] ?? null,
        haveLogoSource: useLogo,
      });
      return { file: spec.file, buffer, width: spec.width, height: spec.height };
    }),
  );
}

export async function probe(buffer: Buffer) {
  const { width, height, format } = await sharp(buffer).metadata();
  return { width: width ?? 0, height: height ?? 0, format: format ?? "unknown" };
}
