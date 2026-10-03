/**
 * Runtime regression for Phase 1C-5C Customer 360 + remote Appointment.
 * A remote-only customer must not crash Customer360Workspace / Appointments tab.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "@/lib/appointments/remote-readiness";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { getCustomerStoredValueBalance } from "@/lib/stored-value/store";
import type { Customer } from "@/types";
import type { AppointmentRemoteReadState } from "@/features/customers/use-appointment-remote-read";
import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";

const { startAt, endAt } = futureQaAppointmentUtcRange();

function liveMappedAppointment(
  overrides: Partial<ScheduleAppointment> = {},
): ScheduleAppointment {
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

function liveRemoteCustomerShape(): Customer {
  return {
    id: FUTURE_QA_APPOINTMENT.customerAppId,
    organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
    name: FUTURE_QA_APPOINTMENT.customerName,
    phone: "0911000001",
    birthday: "",
    age: 0,
    membership: "new",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    joinedAt: "2026/10/02",
    createdAt: "2026-10-02T04:30:00.000Z",
    updatedAt: "2026-10-02T04:30:00.000Z",
  };
}

const remoteCustomer: { current: Customer } = {
  current: liveRemoteCustomerShape(),
};
const remoteAppointments: { current: AppointmentRemoteReadState } = {
  current: { status: "data", value: [liveMappedAppointment()] },
};
const search = { current: "tab=appointments" };

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(search.current),
}));

vi.mock("@/lib/tenant/OrganizationContext", () => ({
  useOrganization: () => ({
    organization: {
      id: FUTURE_QA_APPOINTMENT.organizationAppId,
      name: "THE ENJOYE",
    },
  }),
}));

vi.mock("@/features/customers/use-customer-remote-read", () => ({
  useCustomerRemoteDetail: () => ({
    status: "data",
    value: remoteCustomer.current,
  }),
}));

vi.mock("@/features/customers/use-appointment-remote-read", () => ({
  useCustomerRemoteAppointments: () => remoteAppointments.current,
}));

function renderProfile(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(CustomerProfilePage, {
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        remoteReadPilot: true,
        appointmentRemoteReadPilot: true,
      }),
    );
  });
  return { host, root };
}

describe("Phase 1C-5C Customer Profile runtime", () => {
  const roots: Root[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    search.current = "tab=appointments";
    remoteAppointments.current = { status: "data", value: [liveMappedAppointment()] };
  });

  it("does not throw when reading stored-value balance for a remote-only customer", () => {
    expect(() =>
      getCustomerStoredValueBalance(
        FUTURE_QA_APPOINTMENT.organizationAppId,
        FUTURE_QA_APPOINTMENT.customerAppId,
      ),
    ).not.toThrow();
    expect(
      getCustomerStoredValueBalance(
        FUTURE_QA_APPOINTMENT.organizationAppId,
        FUTURE_QA_APPOINTMENT.customerAppId,
      ),
    ).toBe(0);
  });

  it("renders Customer360Workspace for a remote-shaped customer without throwing", () => {
    search.current = "";
    const { host, root } = renderProfile();
    roots.push(root);
    expect(host.textContent).toContain("Remote QA Customer");
    expect(host.textContent).not.toContain("This page couldn’t load");
  });

  it("renders the appointments tab inside Customer Profile without throwing", () => {
    const { host, root } = renderProfile();
    roots.push(root);
    expect(host.textContent).toContain("Remote QA Bust Care");
    expect(host.textContent).toContain("怡蓁");
    expect(host.textContent).toContain("2026/10/09");
    expect(host.textContent).toContain("已預約");
    expect(host.textContent).not.toContain("This page couldn’t load");
  });
});
