import { spawnSync } from "node:child_process";
import type { NextConfig } from "next";

const repairState = globalThis as typeof globalThis & { __memberPublicationRepair?: boolean };
if (process.env.VERCEL === "1" && !repairState.__memberPublicationRepair) {
  repairState.__memberPublicationRepair = true;
  spawnSync(process.execPath, ["scripts/repair-member-publication.mjs"], { stdio: "inherit" });
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
