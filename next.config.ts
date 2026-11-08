import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only `npm run app` sets this. `next dev` and `next start` stay as they are.
  ...(process.env.ICONMASCHINE_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // A dynamic path in presets.ts makes the tracer copy the whole project into
  // the standalone folder. None of these are read at runtime.
  outputFileTracingExcludes: {
    "**": [
      "./docs/**/*", "./tests/**/*", "./scripts/**/*", "./electron/**/*", "./src/**/*",
      "./dist/**/*", "./.claude/**/*", "./*.md", "./tsconfig*", "./next.config.ts", "./package-lock.json",
    ],
  },
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
