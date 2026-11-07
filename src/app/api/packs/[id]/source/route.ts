import { readSourceImage } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** `?which=artwork`, `logo` or a per-file image id. */
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const which = new URL(request.url).searchParams.get("which") ?? "artwork";
  const buffer = await readSourceImage(id, which);
  if (!buffer) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
