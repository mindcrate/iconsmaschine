import { jsonError } from "@/lib/form";
import { scanKits } from "@/lib/kits";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Your Maschine kits, flagged by whether they already have artwork. */
export async function GET() {
  try {
    return Response.json(await scanKits());
  } catch (err) {
    return jsonError(err);
  }
}
