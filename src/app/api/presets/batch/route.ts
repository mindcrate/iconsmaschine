import { BadRequest, jsonError } from "@/lib/form";
import { OutsideUserContentError } from "@/lib/presets";
import {
  deleteRule,
  InvalidFolderError,
  InvalidTagFieldsError,
  listRules,
  parseTagFields,
  reapplyRule,
  runBatch,
  saveRule,
} from "@/lib/presetbatch";

export const runtime = "nodejs";

const isBadInput = (err: unknown) =>
  err instanceof OutsideUserContentError ||
  err instanceof InvalidTagFieldsError ||
  err instanceof InvalidFolderError;

export async function GET() {
  try {
    return Response.json({ rules: await listRules() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      folder?: unknown;
      fields?: unknown;
    };
    if (typeof body.folder !== "string") throw new BadRequest("No folder given.");
    const { folder } = body;

    switch (body.action) {
      case "preview":
        return Response.json(await runBatch(folder, parseTagFields(body.fields), { dryRun: true }));
      case "apply":
        return Response.json(await runBatch(folder, parseTagFields(body.fields), { dryRun: false }));
      case "save-rule":
        return Response.json({ rule: await saveRule(folder, body.fields) });
      case "delete-rule":
        await deleteRule(folder);
        return Response.json({ deleted: true });
      case "reapply":
        return Response.json(await reapplyRule(folder));
      default:
        throw new BadRequest("Unknown action.");
    }
  } catch (err) {
    return jsonError(err, isBadInput(err) ? 400 : 500);
  }
}
