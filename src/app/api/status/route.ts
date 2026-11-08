import fs from "node:fs/promises";
import { iconmaschineHome, niDistDatabaseDir, niImageDir } from "@/lib/paths";
import { setting } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  const root = niImageDir();
  const distDbDir = niDistDatabaseDir();
  const distDbExists = await fs
    .access(distDbDir)
    .then(() => true)
    .catch(() => false);
  let rootExists = false;
  let rootWritable = false;
  try {
    await fs.access(root);
    rootExists = true;
    await fs.access(root, fs.constants.W_OK);
    rootWritable = true;
  } catch {
    /* reported as-is below */
  }

  return Response.json({
    niImageDir: root,
    rootExists,
    rootWritable,
    home: iconmaschineHome(),
    hasOpenAiKey: Boolean(setting("OPENAI_API_KEY")),
    hasSerpKey: Boolean(setting("SERPAPI_API_KEY")),
    distDbDir,
    distDbExists,
    platform: process.platform,
  });
}
