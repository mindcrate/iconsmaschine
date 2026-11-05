import { buildPack, distDbInputFor, PackNotFound } from "@/lib/build";
import { jsonError } from "@/lib/form";
import { install, planInstall, uninstall } from "@/lib/install";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST with `{ dryRun: true }` to get the plan - which files would be written
 * and what they would overwrite. The UI always shows that before writing.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      dryRun?: boolean;
    };
    const { pack, files } = await buildPack(id);

    const input = {
      product: pack.product,
      vendor: pack.vendor,
      files,
      distDb: distDbInputFor(pack),
    };

    const plan = await planInstall(input);
    if (body.dryRun !== false) return Response.json({ plan });

    if (!plan.rootExists || !plan.rootWritable) {
      return Response.json(
        { error: plan.warnings.join(" ") || "Target folder is not writable." },
        { status: 409 },
      );
    }

    return Response.json({ plan, result: await install(input) });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}

/** Removes a pack's installed files, so a mis-named pack can be retried clean. */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { pack, files } = await buildPack(id);
    const result = await uninstall({
      product: pack.product,
      vendor: pack.vendor,
      files,
      distDb: distDbInputFor(pack),
    });
    return Response.json({ result });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
