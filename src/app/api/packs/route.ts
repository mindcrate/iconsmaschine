import { BadRequest, jsonError, readImageField, readPackFields } from "@/lib/form";
import { listPacks, newPackId, savePack, type Pack } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ packs: await listPacks() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const fields = readPackFields(form);
    const artwork = await readImageField(form, "artwork");
    const logo = await readImageField(form, "logo");

    if (!artwork) throw new BadRequest("Add an artwork image before saving.");

    const now = new Date().toISOString();
    const pack: Pack = {
      ...fields,
      id: newPackId(),
      hasLogo: logo !== null,
      installedAs: null,
      createdAt: now,
      updatedAt: now,
    };

    return Response.json({ pack: await savePack(pack, { artwork, logo }) });
  } catch (err) {
    return jsonError(err);
  }
}
