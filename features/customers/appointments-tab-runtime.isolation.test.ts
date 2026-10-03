/**
 * Runtime regression for Phase 1C-5C Customer 360 Appointments tab.
 * Build/tsc cannot see render-time throws after a successful remote map.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "@/lib/appointments/remote-readiness";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { dbAppointmentFromUnknown } from "@/lib/persistence/authenticated-appointment-read-store";
import { appointmentFromRemoteRow } from "@/lib/persistence/appointment-mapping";
import type { AppointmentRemoteReadState } from "@/features/customers/use-appointment-remote-read";
import { AppointmentsTab } from "@/features/customers/tabs/AppointmentsTab";

const { startAt, endAt } = futureQaAppointmentUtcRange();

const remoteState: { current: AppointmentRemoteReadState } = {
  current: { status: "loading" },
};

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => createElement("a", { href }, children),
}));

vi.mock("@/lib/tenant/OrganizationContext", () => ({
  useOrganization: () => ({
    organization: {
      id: FUTURE_QA_APPOINTMENT.organizationAppId,
      name: "THE ENJOYE",
    },
  }),
}));

vi.mock("@/features/customers/use-appointment-remote-read", () => ({
  useCustomerRemoteAppointments: () => remoteState.current,
}));

function liveMappedAppointment(overrides: Partial<ScheduleAppointment> = {}): ScheduleAppointment {
  return {
    id: "apt-muqrindw-yt0l5z",
    organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
    locationId: FUTURE_QA_APPOINTMENT.locationAppId,
    customerId: FUTURE_QA_APPOINTMENT.customerAppId,
    customerName: FUTURE_QA_APPOINTMENT.customerName,
    serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
    serviceName: FUTURE_QA_APPOINTMENT.serviceName,
    staffId: FUTURE_QA_APPOINTMENT.staffAppId,
    staffName: FUTURE_QA_APPOINTMENT.staffName,
    startAt,
    endAt,
    durationMinutes: 100,
    status: "BOOKED",
    notes: [],
    createdAt: "2026-10-02T09:30:20.517Z",
    updatedAt: "2026-10-02T09:30:20.517Z",
    ...overrides,
  };
}

function renderTab(remote: AppointmentRemoteReadState, remoteReadPilot = true): {
  host: HTMLDivElement;
  root: Root;
} {
  remoteState.current = remote;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(AppointmentsTab, {
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        remoteReadPilot,
      }),
    );
  });
  return { host, root };
}

describe("Phase 1C-5C AppointmentsTab runtime", () => {
  const roots: Root[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("renders the live remote appointment without throwing", () => {
    const { host, root } = renderTab({
      status: "data",
      value: [liveMappedAppointment()],
    });
    roots.push(root);
    expect(host.textContent).toContain("Remote QA Bust Care");
    expect(host.textContent).toContain("測試帳號");
    expect(host.textContent).toContain("2026/10/09");
    expect(host.textContent).toContain("10:00–11:40");
    expect(host.textContent).not.toContain("02:00–03:40");
    expect(host.textContent).toContain("已預約");
    expect(host.textContent).toContain("BOOKED");
  });

  it("maps PostgREST timestamptz shapes through store → domain → Taipei display", () => {
    const shapes = [
      "2026-10-09T02:00:00+00:00",
      "2026-10-09T02:00:00.000000+00:00",
      "2026-10-09 02:00:00+00",
    ];
    for (const starts of shapes) {
      const row = dbAppointmentFromUnknown({
        id: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
        organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        location_id: FUTURE_QA_APPOINTMENT.locationDbId,
        customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
        service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
        staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
        app_id: "apt-muqrindw-yt0l5z",
        starts_at: starts,
        ends_at: "2026-10-09T03:40:00+00:00",
        duration_minutes: 100,
        status: "BOOKED",
        customer_note: null,
        internal_note: null,
        customer_name_snapshot: FUTURE_QA_APPOINTMENT.customerName,
        service_name_snapshot: FUTURE_QA_APPOINTMENT.serviceName,
        staff_name_snapshot: FUTURE_QA_APPOINTMENT.staffName,
        status_reason: null,
        cancelled_at: null,
        cancelled_by: null,
        created_by: FUTURE_QA_APPOINTMENT.staffAppId,
        updated_by: null,
        created_at: "2026-10-02T09:30:20.517+00:00",
        updated_at: "2026-10-02T09:30:20.517+00:00",
      });
      const domain = appointmentFromRemoteRow(
        FUTURE_QA_APPOINTMENT.organizationAppId,
        FUTURE_QA_APPOINTMENT.locationAppId,
        FUTURE_QA_APPOINTMENT.customerAppId,
        FUTURE_QA_APPOINTMENT.serviceAppId,
        row,
      );
      expect(() => formatTaipeiAppointmentDisplay(domain.startAt, domain.endAt)).not.toThrow();
      expect(formatTaipeiAppointmentDisplay(domain.startAt, domain.endAt)).toEqual({
        date: "2026/10/09",
        time: "10:00–11:40",
      });
    }
  });

  it("does not crash the tab when remote state is empty or error", () => {
    const empty = renderTab({ status: "empty" });
    roots.push(empty.root);
    expect(empty.host.textContent).toContain("尚無預約紀錄");
    act(() => empty.root.unmount());
    roots.pop();

    const errored = renderTab({ status: "error", message: "permission denied" });
    roots.push(errored.root);
    expect(errored.host.textContent).toContain("無法讀取預約紀錄");
    expect(errored.host.textContent).toContain("permission denied");
  });

  it("keeps a render-time Taipei display throw inside the tab error UI", () => {
    const { host, root } = renderTab({
      status: "data",
      value: [liveMappedAppointment({ startAt: "not-a-timestamptz", endAt: "also-bad" })],
    });
    roots.push(root);
    expect(host.textContent).toContain("無法讀取預約紀錄");
    expect(host.textContent).toMatch(/Invalid timestamptz|Appointment display failed/);
    expect(host.textContent).not.toContain("This page couldn’t load");
  });
});

describe("Phase 1C-5C server/client appointment pilot boundary", () => {
  it("keeps the RSC customer page off the appointment adapter graph", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-read-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/appointment-remote-read-flag/);
    expect(page).not.toMatch(/appointment-remote-read-pilot/);
    expect(page).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|AuthenticatedAppointmentReadStore|loadAuthenticatedIdentityCatalog|createBrowserClient/);
    expect(flag).not.toMatch(/from ["']@\/lib\/persistence\//);
  });
});
