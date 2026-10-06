import { Suspense } from "react";
import { connection } from "next/server";
import { PackagesPageClient } from "@/features/packages/PackagesPageClient";
import { isCommerceRemoteWritePilotEnabled } from "@/lib/commerce/commerce-remote-write-flag";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { isPackageRemoteReadPilotEnabled } from "@/lib/packages/package-remote-read-flag";

export default async function PackagesPage() {
  await connection();
  return (
    <Suspense fallback={<p className="text-sm text-secondary-text">載入套票…</p>}>
      <PackagesPageClient
        customerRemoteReadPilot={isCustomerRemoteReadPilotEnabled()}
        packageRemoteReadPilot={isPackageRemoteReadPilotEnabled()}
        commerceRemoteWritePilot={isCommerceRemoteWritePilotEnabled()}
      />
    </Suspense>
  );
}
