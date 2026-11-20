import { spawnSync } from "node:child_process";
import type { NextConfig } from "next";

if (process.env.VERCEL === "1") {
  spawnSync(process.execPath, ["scripts/log-publication-schema.mjs"], { stdio: "inherit" });
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
