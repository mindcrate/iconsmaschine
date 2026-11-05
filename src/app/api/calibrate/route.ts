import { calibrate } from "@/lib/calibrate";
import { jsonError } from "@/lib/form";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Reads the NI libraries already installed on this machine and reports the
 * dimensions they actually use, so the built-in spec can be checked against
 * reality.
 */
export async function POST() {
  try {
    return Response.json({ result: await calibrate() });
  } catch (err) {
    return jsonError(err);
  }
}
