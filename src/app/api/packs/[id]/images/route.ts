import { PackNotFound } from "@/lib/build";
import { BadRequest, jsonError, readImageField } from "@/lib/form";
import { clearFileImage, replacePackImage, type ReplaceScope } from "@/lib/packimages";
import { readSourceImage } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const text = (form: FormData, field: string) => {
  const v = form.get(field);
  return typeof v === "string" ? v : "";
};

/**
 * Multipart form: `scope` ("file", "artwork" or "logo"), `file` (the output
 * file, for scope "file"), and either an `image` upload or `fromPack` plus
 * `fromWhich` naming a library image.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const kind = text(form, "scope");
    const scope: ReplaceScope =
      kind === "file" ? { kind: "file", file: text(form, "file") }
      : kind === "artwork" || kind === "logo" ? { kind }
      : (() => { throw new BadRequest("Choose what the new image replaces."); })();

    const fromPack = text(form, "fromPack");
    const image =
      (await readImageField(form, "image")) ??
      (fromPack ? await readSourceImage(fromPack, text(form, "fromWhich")) : null);
    if (!image) throw new BadRequest("Choose an image first.");

    return Response.json(await replacePackImage(id, scope, image));
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}

/** `?file=<output file>` puts that file back on the pack's artwork or logo. */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const file = new URL(request.url).searchParams.get("file") ?? "";
    return Response.json({ pack: await clearFileImage(id, file) });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
