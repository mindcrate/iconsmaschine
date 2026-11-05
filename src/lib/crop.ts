/**
 * Manual crop state for one output file.
 *
 * Stored as a normalised rectangle over the SOURCE image (0..1 on each axis),
 * so it survives the source being re-uploaded at a different resolution and
 * does not depend on the preview's display size.
 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropMap = Record<string, Crop>;

const EPS = 1e-6;

export function isValidCrop(c: unknown): c is Crop {
  if (!c || typeof c !== "object") return false;
  const { x, y, w, h } = c as Crop;
  return (
    [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    w > EPS &&
    h > EPS &&
    x >= -EPS &&
    y >= -EPS &&
    x + w <= 1 + EPS &&
    y + h <= 1 + EPS
  );
}

/** Pulls a crop back inside the image without changing its size if avoidable. */
export function clampCrop(c: Crop): Crop {
  const w = Math.min(Math.max(c.w, EPS), 1);
  const h = Math.min(Math.max(c.h, EPS), 1);
  return {
    w,
    h,
    x: Math.min(Math.max(c.x, 0), 1 - w),
    y: Math.min(Math.max(c.y, 0), 1 - h),
  };
}

/**
 * The crop an untouched `cover` render would produce: the largest centred
 * rectangle of the target aspect ratio. Seeds the editor so opening it and
 * saving immediately is a no-op.
 */
export function defaultCoverCrop(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Crop {
  if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const sourceAspect = sourceW / sourceH;
  const targetAspect = targetW / targetH;

  if (sourceAspect > targetAspect) {
    // Source is wider: full height, crop the sides.
    const w = targetAspect / sourceAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  // Source is taller: full width, crop top and bottom.
  const h = sourceAspect / targetAspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Normalised rect -> integer pixel rect, guaranteed inside the image. */
export function toPixelRect(
  crop: Crop,
  sourceW: number,
  sourceH: number,
): { left: number; top: number; width: number; height: number } {
  const c = clampCrop(crop);
  const width = Math.max(1, Math.min(sourceW, Math.round(c.w * sourceW)));
  const height = Math.max(1, Math.min(sourceH, Math.round(c.h * sourceH)));
  const left = Math.max(0, Math.min(sourceW - width, Math.round(c.x * sourceW)));
  const top = Math.max(0, Math.min(sourceH - height, Math.round(c.y * sourceH)));
  return { left, top, width, height };
}

/**
 * Editor state (zoom + centre point) <-> stored crop.
 *
 * zoom 1 means the crop is as large as it can be for this aspect ratio; higher
 * zoom means a tighter crop.
 */
export function cropFromView(
  zoom: number,
  centreX: number,
  centreY: number,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): Crop {
  const base = defaultCoverCrop(sourceW, sourceH, targetW, targetH);
  const z = Math.max(1, zoom);
  const w = base.w / z;
  const h = base.h / z;
  return clampCrop({ x: centreX - w / 2, y: centreY - h / 2, w, h });
}

export function viewFromCrop(
  crop: Crop,
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): { zoom: number; centreX: number; centreY: number } {
  const base = defaultCoverCrop(sourceW, sourceH, targetW, targetH);
  const c = clampCrop(crop);
  return {
    zoom: Math.max(1, base.w / c.w),
    centreX: c.x + c.w / 2,
    centreY: c.y + c.h / 2,
  };
}
