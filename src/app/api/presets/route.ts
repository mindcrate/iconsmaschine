import { BadRequest, jsonError } from "@/lib/form";
import {
  listPresets,
  OutsideUserContentError,
  readPreset,
  restorePreset,
  writePreset,
} from "@/lib/presets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const rel = new URL(request.url).searchParams.get("path");
    if (rel) return Response.json(await readPreset(rel));
    return Response.json(await listPresets());
  } catch (err) {
    return jsonError(err, err instanceof OutsideUserContentError ? 400 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      path?: string;
      action?: "write" | "restore";
      vendor?: string;
      bankchain?: string[];
      types?: string[][];
      characters?: string[];
      author?: string;
      comment?: string;
      backup?: boolean;
    };

    if (!body.path) throw new BadRequest("No preset path given.");

    if (body.action === "restore") {
      await restorePreset(body.path);
      return Response.json({ restored: true });
    }

    const result = await writePreset(
      body.path,
      {
        vendor: body.vendor,
        bankchain: body.bankchain,
        types: body.types,
        characters: body.characters,
        author: body.author,
        comment: body.comment,
      },
      { backup: body.backup !== false },
    );
    return Response.json({ result });
  } catch (err) {
    return jsonError(err, err instanceof OutsideUserContentError ? 400 : 500);
  }
}
