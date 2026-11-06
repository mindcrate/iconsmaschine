/**
 * The shape of a text overlay, and the pure helpers around it.
 *
 * Kept apart from the renderer because this module is imported by the browser
 * for the controls, and the renderer pulls in sharp. A value import of the
 * defaults from the rendering module dragged node bindings into the client
 * bundle and broke the build.
 */

/**
 * Longest overlay text accepted. The renderer scales text down to fit its
 * box, so a long line does not overflow - it just becomes unreadably small,
 * which is worse than being told to shorten it.
 */
export const MAX_OVERLAY_TEXT = 64;

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
export function overlayAppliesTo(
  overlay: TextOverlay | null,
  file: string,
): boolean {
  return Boolean(overlay && overlay.text.trim() && overlay.files.includes(file));
}

/**
 * Builds a TextOverlay from untrusted JSON, clamping every field.
 *
 * Returns null for an empty or absent text, since an overlay with nothing to
 * draw is the same as no overlay and should not cost a render pass.
 */
export function parseOverlay(value: unknown): TextOverlay | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const text = typeof v.text === "string" ? v.text.trim() : "";
  if (!text) return null;

  const num = (x: unknown, lo: number, hi: number, dflt: number) => {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
  };
  const oneOf = <T extends string>(x: unknown, allowed: readonly T[], dflt: T): T =>
    allowed.includes(x as T) ? (x as T) : dflt;

  return {
    text: text.slice(0, MAX_OVERLAY_TEXT),
    font: (typeof v.font === "string" && v.font.trim()) || DEFAULT_OVERLAY.font,
    weight: oneOf(v.weight, ["normal", "bold"] as const, DEFAULT_OVERLAY.weight),
    italic: v.italic === true,
    color: normaliseHexColor(String(v.color ?? ""), DEFAULT_OVERLAY.color),
    sizePct: num(v.sizePct, 0.05, 1, DEFAULT_OVERLAY.sizePct),
    letterSpacing: num(v.letterSpacing, -20, 100, DEFAULT_OVERLAY.letterSpacing),
    align: oneOf(v.align, ["left", "centre", "right"] as const, DEFAULT_OVERLAY.align),
    backgroundOpacity: num(v.backgroundOpacity, 0, 1, DEFAULT_OVERLAY.backgroundOpacity),
    backgroundColor:
      v.backgroundColor === null || v.backgroundColor === undefined
        ? null
        : normaliseHexColor(String(v.backgroundColor), "#000000"),
    files: Array.isArray(v.files)
      ? v.files.filter((f): f is string => typeof f === "string").slice(0, 16)
      : [],
  };
}
