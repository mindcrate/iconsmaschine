import { jsonError, readImageField, readPackFields } from "@/lib/form";
import { deletePack, readPack, savePack } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const pack = await readPack(id);
  if (!pack) return Response.json({ error: "Pack not found." }, { status: 404 });
  return Response.json({ pack });
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const existing = await readPack(id);
    if (!existing)
      return Response.json({ error: "Pack not found." }, { status: 404 });

    const form = await request.formData();
    const fields = readPackFields(form);
    const artwork = await readImageField(form, "artwork");
    const logo = await readImageField(form, "logo");
    const clearLogo = form.get("clearLogo") === "true";

    const pack = {
      ...existing,
      ...fields,
      installedAs: existing.installedAs ?? null,
      hasLogo: clearLogo ? false : existing.hasLogo || logo !== null,
    };

    const saved = await savePack(pack, {
      ...(artwork ? { artwork } : {}),
      logo: clearLogo ? null : logo,
    });
    return Response.json({ pack: saved });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deletePack(id);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
