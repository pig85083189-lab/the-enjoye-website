"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  getSessionRaw,
  resolveStaffEntryHref,
  subscribeAuth,
} from "@/lib/auth";

/**
 * Phase 4.9C.1 — `/staff` must not 404.
 * Reuses the same mock session source as StaffShell (`getSessionRaw`).
 */
export default function StaffEntryPage() {
  const router = useRouter();
  const sessionRaw = useSyncExternalStore(subscribeAuth, getSessionRaw, () => null);

  useEffect(() => {
    router.replace(resolveStaffEntryHref(sessionRaw));
  }, [sessionRaw, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-secondary-text">
      載入中…
    </div>
  );
}
