import { jsonError } from "@/lib/form";
import { readVocabulary } from "@/lib/vocab";

export const runtime = "nodejs";

/** The FileType / Category strings in use by installed dist_database entries. */
export async function GET() {
  try {
    return Response.json(await readVocabulary());
  } catch (err) {
    return jsonError(err);
  }
}
