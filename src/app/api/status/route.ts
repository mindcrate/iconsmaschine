import fs from "node:fs/promises";
import { hasMetaTemplate } from "@/lib/meta";
import { iconmaschineHome, niImageDir } from "@/lib/paths";

export const runtime = "nodejs";

export async function GET() {
  const root = niImageDir();
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
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    hasMetaTemplate: await hasMetaTemplate(),
    platform: process.platform,
  });
}
