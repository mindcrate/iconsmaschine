import sharp from "sharp";
import { BadRequest, jsonError } from "@/lib/form";
import {
  fetchRemoteImage,
  MissingSerpKeyError,
  searchImages,
} from "@/lib/imagesearch";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Search. Returns metadata only - no image bytes cross the wire yet. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim();
    if (query.length < 2) throw new BadRequest("Enter something to search for.");

    const results = await searchImages({
      query,
      transparent: params.get("transparent") === "true",
      large: params.get("large") !== "false",
    });
    return Response.json({ results });
  } catch (err) {
    return jsonError(err, err instanceof MissingSerpKeyError ? 400 : 500);
  }
}

/**
 * Fetches one chosen result and returns it as a PNG data URL, so the browser
 * never has to reach the third-party host itself (and CORS is a non-issue).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    if (!body.url) throw new BadRequest("No image URL given.");

    const raw = await fetchRemoteImage(body.url);

    let png: Buffer;
    try {
      // Normalise to PNG, preserving alpha so transparent logos stay transparent.
      png = await sharp(raw).png().toBuffer();
    } catch {
      throw new BadRequest("That file could not be read as an image.");
    }

    const meta = await sharp(png).metadata();
    return Response.json({
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      hasAlpha: meta.hasAlpha ?? false,
    });
  } catch (err) {
    return jsonError(err);
  }
}
