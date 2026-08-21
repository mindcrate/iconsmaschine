import { calibrate } from "@/lib/calibrate";
import { jsonError } from "@/lib/form";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Reads the NI libraries already installed on this machine and reports the
 * dimensions they actually use, so the built-in spec can be checked against
 * reality. Optionally harvests a real `.meta` to use as the template.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      harvestMeta?: boolean;
    };
    return Response.json({
      result: await calibrate({ harvestMeta: body.harvestMeta !== false }),
    });
  } catch (err) {
    return jsonError(err);
  }
}
