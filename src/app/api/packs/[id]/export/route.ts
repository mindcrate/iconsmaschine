import { buildPack, PackNotFound } from "@/lib/build";
import { jsonError } from "@/lib/form";
import { readMetaTemplate } from "@/lib/meta";
import { zipPack } from "@/lib/zip";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { pack, files } = await buildPack(id);
    const zip = zipPack({
      vendor: pack.vendor,
      subfolder: pack.subfolder,
      files,
      meta: await readMetaTemplate(),
    });

    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${pack.vendor.replace(/"/g, "")}.zip"`,
      },
    });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
