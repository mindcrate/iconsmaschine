import { buildPack, distDbInputFor, PackNotFound } from "@/lib/build";
import { jsonError } from "@/lib/form";
import { install, planInstall, uninstall } from "@/lib/install";
import { scanKits } from "@/lib/kits";
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
      // A user sample pack nests under its vendor without a dist_database
      // entry. Plugins already nest through theirs.
      imageVendor: pack.nestImage && pack.vendor ? pack.vendor : null,
      previous: pack.installedAs,
    };

    const plan = await planInstall(input);
    await warnIfMaschineDisagrees(plan, pack.product);
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
        nested: needsDistDb(pack) || Boolean(pack.nestImage && pack.vendor),
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
      imageVendor: pack.nestImage && pack.vendor ? pack.vendor : null,
    });
    await savePack({ ...pack, installedAs: null });
    return Response.json({ result });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}


/**
 * Hold the plan against what Maschine's own database says the folder should
 * be, and say so when they differ.
 *
 * Both ends look right in isolation when they disagree: the app writes a
 * plausible folder and Maschine looks in a plausible folder, and nothing
 * reports that they are not the same one. 808 COLLECTION installed flat to
 * image/808 collection/ while its sounds, carrying vendor "tim moose",
 * resolved to image/tim moose/808 collection/.
 */
async function warnIfMaschineDisagrees(
  plan: { imageRoot: string; imageDir: string; warnings: string[] },
  product: string,
): Promise<void> {
  let kits;
  try {
    ({ kits } = await scanKits());
  } catch {
    return; // no database to compare against; the plan stands on its own
  }

  const want = product.trim().toLowerCase();
  const kit = kits.find((k) => k.name.trim().toLowerCase() === want);
  if (!kit) return;

  const planned = plan.imageDir.startsWith(`${plan.imageRoot}/`)
    ? plan.imageDir.slice(plan.imageRoot.length + 1)
    : plan.imageDir;
  if (planned === kit.folder) return;

  plan.warnings.push(
    `Maschine lists "${kit.name}" as resolving to image/${kit.folder}/, but this would write to image/${planned}/. ` +
      (kit.nestUnder
        ? `Its content carries the vendor "${kit.vendor}", so set Vendor to that and tick "Nest under the vendor".`
        : `Its content carries no vendor, so untick "Nest under the vendor".`) +
      ` Artwork in the other folder will not be found.`,
  );
}
