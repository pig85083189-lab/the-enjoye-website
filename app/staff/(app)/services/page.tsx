import { connection } from "next/server";
import { ServiceCatalogPageClient } from "@/features/services/ServiceCatalogPageClient";
import { isServiceRemoteReadPilotEnabled } from "@/lib/services/service-remote-read-flag";
import { isServiceRemoteWritePilotEnabled } from "@/lib/services/service-remote-write-flag";

export default async function StaffServicesPage() {
  await connection();
  return (
    <ServiceCatalogPageClient
      remoteReadPilot={isServiceRemoteReadPilotEnabled()}
      remoteWritePilot={isServiceRemoteWritePilotEnabled()}
    />
  );
}
