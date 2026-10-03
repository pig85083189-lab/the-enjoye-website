"use client";

import { AppointmentSections, AppointmentsTab } from "@/features/customers/tabs/AppointmentsTab";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { ISOLATION_CUSTOMER_APP_ID, liveMappedAppointment } from "./live-appointment-fixture";

export function StageEAppointmentsShell() {
  return (
    <div data-isolation-stage="E">
      <AppointmentsTab
        customerId={ISOLATION_CUSTOMER_APP_ID}
        remoteReadPilot
        isolationRemoteState={{ status: "loading" }}
      />
    </div>
  );
}

export function StageFAppointmentsEmpty() {
  return (
    <div data-isolation-stage="F">
      <AppointmentsTab
        customerId={ISOLATION_CUSTOMER_APP_ID}
        remoteReadPilot
        isolationRemoteState={{ status: "empty" }}
      />
    </div>
  );
}

export function StageGAppointmentsRemoteRow() {
  return (
    <div data-isolation-stage="G">
      <AppointmentsTab customerId={ISOLATION_CUSTOMER_APP_ID} remoteReadPilot />
    </div>
  );
}

export function StageHAppointmentCard() {
  return (
    <div data-isolation-stage="H">
      <AppointmentSections
        items={[liveMappedAppointment()]}
        formatDisplay={(item) => formatTaipeiAppointmentDisplay(item.startAt, item.endAt)}
        showCanonicalStatus
        showCalendarLink={false}
        emptyUpcoming="尚無預約紀錄"
        emptyHistory="尚無預約紀錄"
      />
    </div>
  );
}
