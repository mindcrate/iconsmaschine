import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  // The app's "@/..." alias (tsconfig paths) points at src/.
  if (specifier.startsWith("@/")) {
    specifier = new URL(specifier.slice(2), SRC).href;
  }
  if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(specifier + ext, context);
      }
    }
  }
  return next(specifier, context);
}
