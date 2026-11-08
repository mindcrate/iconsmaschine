import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only `npm run app` sets this. `next dev` and `next start` stay as they are.
  ...(process.env.ICONMASCHINE_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
