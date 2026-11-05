import sharp from "sharp";

/**
 * Text overlays for the logo and banner files.
 *
 * A pack often wants the kit's name across the banner rather than a cropped
 * photo. The artwork sits behind at reduced opacity (or is dropped entirely
 * for a flat colour), with the text composited on top.
 */

export interface TextOverlay {
  text: string;
  /** Font family name as the OS knows it, e.g. "Helvetica Neue". */
  font: string;
  weight: "normal" | "bold";
  italic: boolean;
  /** Fill colour, 6-digit hex with or without a leading hash. */
  color: string;
  /** Text height as a fraction of the box height. */
  sizePct: number;
  /** Extra tracking, as a percentage of font size. */
  letterSpacing: number;
  align: "left" | "centre" | "right";
  /** 0 hides the artwork entirely, 1 leaves it untouched. */
  backgroundOpacity: number;
  /** Painted under the artwork. Null means transparent. */
  backgroundColor: string | null;
  /** Which output files get the overlay. */
  files: string[];
}

export const DEFAULT_OVERLAY: TextOverlay = {
  text: "",
  font: "Helvetica",
  weight: "bold",
  italic: false,
  color: "#ffffff",
  sizePct: 0.5,
  letterSpacing: 0,
  align: "centre",
  backgroundOpacity: 0.45,
  backgroundColor: "#000000",
  files: [],
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function normaliseHexColor(hex: string, fallback = "#ffffff"): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

/**
 * Rendering the text.
 *
 * Estimating glyph widths does not work. A 0.58em average underestimates bold
 * uppercase badly enough that "MASCHINE KITS" overflowed a 240px box and was
 * clipped at the edge. sharp exposes no text metrics, so the text is instead
 * rendered large on a transparent canvas, trimmed to its real ink bounds, and
 * scaled to fit. That measures rather than guesses, and holds for any font,
 * weight and string.
 */

/** Rendered at this size, then scaled down - big enough to stay crisp. */
const MEASURE_SIZE = 256;

function textSvgAtSize(overlay: TextOverlay, fontSize: number): Buffer {
  const colour = normaliseHexColor(overlay.color);
  const spacing =
    overlay.letterSpacing !== 0
      ? ` letter-spacing="${((overlay.letterSpacing / 100) * fontSize).toFixed(2)}"`
      : "";
  // A canvas generously larger than the text can possibly be, so nothing is
  // clipped before trimming.
  const w =
    Math.ceil(fontSize * Math.max(overlay.text.length, 1) * 1.6) + fontSize * 2;
  const h = Math.ceil(fontSize * 2.4);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<text x="${Math.round(w / 2)}" y="${Math.round(h * 0.62)}" text-anchor="middle"` +
    ` font-family="${escapeXml(overlay.font)}"` +
    ` font-size="${fontSize}"` +
    ` font-weight="${overlay.weight}"` +
    (overlay.italic ? ` font-style="italic"` : "") +
    ` fill="${colour}"${spacing}>` +
    escapeXml(overlay.text) +
    `</text></svg>`;
  return Buffer.from(svg, "utf8");
}

export interface RenderedText {
  buffer: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Produces the text layer, already sized and positioned for the box.
 *
 * Returns null when there is nothing to draw, or when the text trims to
 * nothing - which is what happens if the font name does not resolve on this
 * machine and the glyphs come out blank.
 */
export async function renderText(
  overlay: TextOverlay,
  boxW: number,
  boxH: number,
): Promise<RenderedText | null> {
  if (!overlay.text.trim()) return null;

  let trimmed: { data: Buffer; info: { width: number; height: number } };
  try {
    trimmed = await sharp(textSvgAtSize(overlay, MEASURE_SIZE), { density: 144 })
      .trim({ threshold: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    // trim() throws when the image is entirely blank.
    return null;
  }
  if (trimmed.info.width < 1 || trimmed.info.height < 1) return null;

  // Fit the measured text: capped by height via sizePct, and by width with a
  // margin so it never touches the edge.
  const maxH = boxH * Math.min(Math.max(overlay.sizePct, 0.05), 1);
  const maxW = boxW * 0.9;
  const scale = Math.min(maxH / trimmed.info.height, maxW / trimmed.info.width);

  const width = Math.max(1, Math.round(trimmed.info.width * scale));
  const height = Math.max(1, Math.round(trimmed.info.height * scale));
  const buffer = await sharp(trimmed.data).resize(width, height).png().toBuffer();

  const left =
    overlay.align === "left"
      ? Math.round(boxW * 0.05)
      : overlay.align === "right"
        ? boxW - width - Math.round(boxW * 0.05)
        : Math.round((boxW - width) / 2);

  return {
    buffer,
    width,
    height,
    left: Math.max(0, Math.min(left, Math.max(0, boxW - width))),
    top: Math.max(0, Math.round((boxH - height) / 2)),
  };
}

export function overlayAppliesTo(
  overlay: TextOverlay | null,
  file: string,
): boolean {
  return Boolean(overlay && overlay.text.trim() && overlay.files.includes(file));
}
