import { buildPack, distDbInputFor, PackNotFound } from "@/lib/build";
import { jsonError } from "@/lib/form";
import { install, planInstall, uninstall } from "@/lib/install";
import { needsDistDb, savePack } from "@/lib/store";

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
      cleanStale?: boolean;
    };
    const { pack, files } = await buildPack(id);

    const input = {
      product: pack.product,
      vendor: pack.vendor,
      files,
      distDb: distDbInputFor(pack),
      previous: pack.installedAs,
    };

    const plan = await planInstall(input);
    if (body.dryRun !== false) return Response.json({ plan });

    if (!plan.rootExists || !plan.rootWritable) {
      return Response.json(
        { error: plan.warnings.join(" ") || "Target folder is not writable." },
        { status: 409 },
      );
    }

    const result = await install(input, { cleanStale: body.cleanStale !== false });

    // Remember where it landed, so a later rename can clean up after itself.
    await savePack({
      ...pack,
      installedAs: {
        vendor: pack.vendor,
        product: pack.product,
        distDb: needsDistDb(pack),
      },
    });

    return Response.json({ plan, result });
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
    await savePack({ ...pack, installedAs: null });
    return Response.json({ result });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
