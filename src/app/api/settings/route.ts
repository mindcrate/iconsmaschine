import { iconmaschineHome } from "@/lib/paths";
import { SETTING_NAMES, saveSettings, settingsStatus, type Settings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ settings: settingsStatus(), home: iconmaschineHome() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Send a JSON object." }, { status: 400 });
  }
  const changes: Settings = {};
  for (const n of SETTING_NAMES) {
    if (typeof body[n] === "string") changes[n] = body[n] as string;
  }
  await saveSettings(changes);
  return Response.json({ settings: settingsStatus(), home: iconmaschineHome() });
}
