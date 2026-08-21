import sharp from "sharp";
import { KIT_TYPES, validateFolderName, type KitType } from "./spec";
import type { Pack } from "./store";

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

/** Guards against a huge upload wedging the local server. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export async function readImageField(
  form: FormData,
  field: string,
): Promise<Buffer | null> {
  const value = form.get(field);
  if (!value || typeof value === "string") return null;
  if (value.size === 0) return null;
  if (value.size > MAX_SOURCE_BYTES) {
    throw new BadRequest(
      `${field} is ${(value.size / 1e6).toFixed(1)} MB - keep source images under 25 MB.`,
    );
  }
  const buffer = Buffer.from(await value.arrayBuffer());
  try {
    // Normalise to PNG so everything downstream has one predictable format.
    return await sharp(buffer).png().toBuffer();
  } catch {
    throw new BadRequest(
      `${field} could not be read as an image. Use PNG, JPEG, WebP or TIFF.`,
    );
  }
}

function str(form: FormData, field: string, fallback = ""): string {
  const v = form.get(field);
  return typeof v === "string" ? v : fallback;
}

function bool(form: FormData, field: string): boolean {
  return str(form, field) === "true";
}

export function readPackFields(
  form: FormData,
): Omit<Pack, "id" | "createdAt" | "updatedAt" | "hasLogo"> {
  const kitType = str(form, "kitType") as KitType;
  const info = KIT_TYPES.find((k) => k.id === kitType);
  if (!info) throw new BadRequest(`Unknown kit type: ${kitType || "(none)"}`);

  const vendor = str(form, "vendor");
  const vendorError = validateFolderName(vendor);
  if (vendorError) throw new BadRequest(`Folder name: ${vendorError}`);

  let subfolder: string | null = str(form, "subfolder").trim() || null;
  if (subfolder && !info.usesSubfolder) subfolder = null;
  if (subfolder) {
    const subError = validateFolderName(subfolder);
    if (subError) throw new BadRequest(`Subfolder name: ${subError}`);
  }

  const paddingRaw = Number(str(form, "padding", "0.08"));
  const padding = Number.isFinite(paddingRaw)
    ? Math.min(Math.max(paddingRaw, 0), 0.4)
    : 0.08;

  const background = str(form, "background").trim() || null;
  if (background && !/^#?[0-9a-f]{6}$/i.test(background)) {
    throw new BadRequest("Background must be a 6-digit hex colour, e.g. #101010.");
  }

  const tags = str(form, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    name: str(form, "name").trim() || subfolder || vendor,
    kitType,
    vendor,
    subfolder,
    nks2: bool(form, "nks2"),
    background,
    padding,
    author: str(form, "author").trim(),
    share: bool(form, "share"),
    tags,
  };
}

export function jsonError(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json(
    { error: message },
    { status: err instanceof BadRequest ? 400 : status },
  );
}
