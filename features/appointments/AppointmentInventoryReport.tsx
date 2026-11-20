"use client";

import { useEffect, useState } from "react";
import { loadAppointmentInventoryReport } from "@/lib/appointments/appointment-inventory-action";
import {
  buildLocalAppointmentInventory,
  readPersistedInventoryAppointments,
  type LocalAppointmentInventoryReport,
} from "@/lib/appointments/local-appointment-inventory";
import { inventoryDirectoryForPage } from "@/lib/appointments/appointment-inventory-directory";

export function AppointmentInventoryReport({
  organizationId,
  nowIso,
}: {
  organizationId: string;
  nowIso: string;
}) {
  const [report, setReport] = useState<LocalAppointmentInventoryReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    const localAppointments = readPersistedInventoryAppointments(organizationId);
    void loadAppointmentInventoryReport({ nowIso, localAppointments })
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReport(buildLocalAppointmentInventory({
          organizationId,
          now: new Date(nowIso),
          localAppointments,
          directory: inventoryDirectoryForPage(
            {
              remoteCheck: "unavailable",
              message: error instanceof Error ? error.message : "無法讀取正式資料",
            },
            organizationId,
          ),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [nowIso, organizationId]);

  return (
    <article className="min-w-0" data-appointment-inventory="readonly">
      <header className="mb-4 space-y-1">
        <h1 className="text-xl font-semibold text-text">本機預約盤點</h1>
        <p className="text-sm text-secondary-text">
          這份報告只讀取這台瀏覽器已儲存的預約，並與正式資料的身分編號比對。它不會建立、修改或清除任何預約。
        </p>
      </header>
      <pre className="overflow-auto rounded-2xl border border-border bg-surface p-4 text-xs text-text">
        {report ? JSON.stringify(report, null, 2) : ""}
      </pre>
    </article>
  );
}
