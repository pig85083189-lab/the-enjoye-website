"use client";

import { useMemo } from "react";
import {
  buildLocalAppointmentInventory,
  readPersistedInventoryAppointments,
  type InventoryIdentityDirectory,
} from "@/lib/appointments/local-appointment-inventory";

export function AppointmentInventoryReport({
  organizationId,
  directory,
  nowIso,
}: {
  organizationId: string;
  directory: InventoryIdentityDirectory;
  nowIso: string;
}) {
  const report = useMemo(
    () => buildLocalAppointmentInventory({
      organizationId,
      now: new Date(nowIso),
      localAppointments: readPersistedInventoryAppointments(organizationId),
      directory,
    }),
    [directory, nowIso, organizationId],
  );

  return (
    <article className="min-w-0" data-appointment-inventory="readonly">
      <header className="mb-4 space-y-1">
        <h1 className="text-xl font-semibold text-text">本機預約盤點</h1>
        <p className="text-sm text-secondary-text">
          這份報告只讀取這台瀏覽器已儲存的預約，並與正式資料的身分編號比對。它不會建立、修改或清除任何預約。
        </p>
      </header>
      <pre className="overflow-auto rounded-2xl border border-border bg-surface p-4 text-xs text-text">
        {JSON.stringify(report, null, 2)}
      </pre>
    </article>
  );
}
