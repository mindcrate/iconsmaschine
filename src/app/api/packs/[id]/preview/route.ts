import { buildPack, PackNotFound } from "@/lib/build";
import { jsonError } from "@/lib/form";
import { specsFor } from "@/lib/spec";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { pack, files } = await buildPack(id);
    const specs = specsFor({ nks2: pack.nks2 });

    return Response.json({
      files: files.map((f) => {
        const spec = specs.find((s) => s.file === f.file)!;
        return {
          file: f.file,
          width: f.width,
          height: f.height,
          bytes: f.buffer.length,
          description: spec.description,
          unverified: spec.unverified ?? false,
          dataUrl: `data:image/${spec.format};base64,${f.buffer.toString("base64")}`,
        };
      }),
    });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
