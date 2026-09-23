"use client";

import { Suspense } from "react";
import { CheckoutPageClient } from "@/features/checkout/CheckoutPageClient";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p className="text-sm text-secondary-text">載入結帳…</p>}>
      <CheckoutPageClient />
    </Suspense>
  );
}
