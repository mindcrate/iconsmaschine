import { readSources } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const which = new URL(request.url).searchParams.get("which") ?? "artwork";
  const sources = await readSources(id);
  const buffer = which === "logo" ? sources.logo : sources.artwork;
  if (!buffer) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
