/**
 * Test-only module resolver.
 *
 * The app uses extensionless relative imports, which the Next.js bundler
 * resolves but bare Node ESM does not. This maps `./foo` to `./foo.ts` so the
 * same source can be exercised directly under `node --test`.
 */
import { register } from "node:module";

register(new URL("./ts-hooks.mjs", import.meta.url));
