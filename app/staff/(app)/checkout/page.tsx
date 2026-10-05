import { Suspense } from "react";
import { connection } from "next/server";
import { CheckoutPageClient } from "@/features/checkout/CheckoutPageClient";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";
import { isCommerceRemoteWritePilotEnabled } from "@/lib/commerce/commerce-remote-write-flag";

export default async function CheckoutPage() {
  await connection();
  return (
    <Suspense fallback={<p className="text-sm text-secondary-text">載入結帳…</p>}>
      <CheckoutPageClient
        commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
        commerceRemoteWritePilot={isCommerceRemoteWritePilotEnabled()}
      />
    </Suspense>
  );
}
