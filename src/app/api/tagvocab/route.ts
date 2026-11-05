import { jsonError } from "@/lib/form";
import { readTagVocabulary } from "@/lib/tagvocab";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Types and Characters, read from Maschine's own browser database. */
export async function GET() {
  try {
    return Response.json(await readTagVocabulary());
  } catch (err) {
    return jsonError(err);
  }
}
