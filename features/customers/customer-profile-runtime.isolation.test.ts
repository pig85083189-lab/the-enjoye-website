/**
 * Runtime isolation for Customer Profile + appointments tab.
 * Proves which layer throws after Owner diagnostic A–I already passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import { getCustomerStoredValueBalance } from "@/lib/stored-value/store";
import type { Customer } from "@/types";
import type { AppointmentRemoteReadState } from "@/features/customers/use-appointment-remote-read";
import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";
import { liveMappedAppointment, liveRemoteCustomerShape } from "./isolation/live-appointment-fixture";

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

function renderProfile(props: Record<string, unknown> = {}): {
  host: HTMLDivElement;
  root: Root;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(CustomerProfilePage, {
        customerId: FUTURE_QA_APPOINTMENT.customerAppId,
        remoteReadPilot: true,
        appointmentRemoteReadPilot: true,
        ...props,
      }),
    );
  });
  return { host, root };
}

describe("Phase 1C-5C Customer Profile runtime isolation", () => {
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

  it("renders CustomerProfilePage shell without Customer360Workspace", () => {
    const { host, root } = renderProfile({ isolationLayer: "shell" });
    roots.push(root);
    expect(host.textContent).toContain("CustomerProfilePage shell");
    expect(host.textContent).toContain("Remote QA Customer");
    expect(host.textContent).not.toContain("即將到來");
  });

  it("renders Customer360Workspace without throwing on a remote-shaped customer", () => {
    search.current = "";
    const { host, root } = renderProfile({ isolationLayer: "workspace" });
    roots.push(root);
    expect(host.textContent).toContain("Remote QA Customer");
    expect(host.textContent).not.toContain("This page couldn’t load");
  });

  it("renders the full appointments tab inside Customer Profile without throwing", () => {
    const { host, root } = renderProfile({
      isolationLayer: "full",
      isolationTab: "appointments",
    });
    roots.push(root);
    expect(host.textContent).toContain("Remote QA Bust Care");
    expect(host.textContent).toContain("怡蓁");
    expect(host.textContent).toContain("2026/10/09");
    expect(host.textContent).not.toContain("This page couldn’t load");
  });
});
