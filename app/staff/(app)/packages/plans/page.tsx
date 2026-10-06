import { connection } from "next/server";
import { PackagePlansPageClient } from "@/features/packages/PackagePlansPageClient";
import { isPackageRemoteReadPilotEnabled } from "@/lib/packages/package-remote-read-flag";
import { isPackageRemoteWritePilotEnabled } from "@/lib/packages/package-remote-write-flag";

export default async function PackagePlansPage() {
  await connection();
  return (
    <PackagePlansPageClient
      packageRemoteReadPilot={isPackageRemoteReadPilotEnabled()}
      packageRemoteWritePilot={isPackageRemoteWritePilotEnabled()}
    />
  );
}
