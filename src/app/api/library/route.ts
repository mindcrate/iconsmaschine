import { jsonError } from "@/lib/form";
import { listLibrary } from "@/lib/packimages";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ images: await listLibrary() });
  } catch (err) {
    return jsonError(err);
  }
}
