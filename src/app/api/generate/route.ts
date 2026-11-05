import {
  decoratePrompt,
  generateArtwork,
  MissingApiKeyError,
  NoUsableModelError,
  type AiSize,
} from "@/lib/ai";
import { BadRequest, jsonError } from "@/lib/form";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      prompt?: string;
      size?: AiSize;
      quality?: "low" | "medium" | "high";
    };

    const prompt = (body.prompt ?? "").trim();
    if (prompt.length < 3) throw new BadRequest("Describe the artwork you want.");
    if (prompt.length > 2000) throw new BadRequest("Keep the prompt under 2000 characters.");

    const size: AiSize = body.size === "1536x1024" ? "1536x1024" : "1024x1024";
    const quality = body.quality ?? "medium";

    const { image, model } = await generateArtwork({
      prompt: decoratePrompt(prompt),
      size,
      quality,
    });

    return Response.json({
      dataUrl: `data:image/png;base64,${image.toString("base64")}`,
      model,
    });
  } catch (err) {
    const expected =
      err instanceof MissingApiKeyError || err instanceof NoUsableModelError;
    return jsonError(err, expected ? 400 : 500);
  }
}
