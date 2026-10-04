import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  pickRemoteAppointmentForCustomer,
  resolveTreatmentAppointmentIdentitySource,
  resolveTreatmentCustomerIdentitySource,
  toTreatmentAppointment,
  treatmentWorkspaceEntryHref,
} from "./treatment-identity";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function apt(
  over: Partial<ScheduleAppointment> & Pick<ScheduleAppointment, "id" | "status">,
): ScheduleAppointment {
  return {
    organizationId: "org-the-enjoye",
    locationId: "loc-enjoye-main",
    customerId: "cust-remote-qa",
    customerName: "Remote QA Customer",
    serviceId: "svc-muqm5pht-nqlpr3",
    serviceName: "Remote QA Service",
    staffId: "staff-001",
    staffName: "測試帳號",
    startAt: "2026-10-04T02:00:00.000Z",
    endAt: "2026-10-04T03:40:00.000Z",
    durationMinutes: 100,
    notes: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("Phase 1C-6D.2F Treatment customer identity", () => {
  it("keeps remote Customer identity separate from local Treatment records", () => {
    expect(resolveTreatmentCustomerIdentitySource(true)).toBe("remote");
    expect(resolveTreatmentCustomerIdentitySource(false)).toBe("local");
    expect(resolveTreatmentAppointmentIdentitySource(true)).toBe("remote");
    expect(resolveTreatmentAppointmentIdentitySource(false)).toBe("local");
    expect(
      treatmentWorkspaceEntryHref({
        customerId: "cust-remote-qa",
        appointmentId: "apt-muqrindw-yt0l5z",
      }),
    ).toBe("/staff/treatments/new?customer=cust-remote-qa&appointment=apt-muqrindw-yt0l5z");
    expect(treatmentWorkspaceEntryHref({ customerId: "cust-remote-qa" })).toBe(
      "/staff/treatments/new?customer=cust-remote-qa",
    );
  });

  it("picks an open remote appointment without guessing by name or phone", () => {
    const picked = pickRemoteAppointmentForCustomer([
      apt({ id: "apt-cancelled", status: "CANCELLED" }),
      apt({ id: "apt-open", status: "CONFIRMED" }),
      apt({ id: "apt-done", status: "COMPLETED" }),
    ]);
    expect(picked?.id).toBe("apt-open");
    const legacy = toTreatmentAppointment(picked!);
    expect(legacy.customerId).toBe("cust-remote-qa");
    expect(legacy.customerName).toBe("Remote QA Customer");
  });

  it("wires every Treatment entry to canonical remote Customer identity", () => {
    const page = read("features/treatments/TreatmentPageClient.tsx");
    const list = read("features/treatments/TreatmentsListPageClient.tsx");
    const detail = read("features/treatments/TreatmentDetailReadonly.tsx");
    const hook = read("features/treatments/use-treatment-customer-identity.ts");
    const snapshot = read("features/customers/use-customer-360.ts");
    const today = read("lib/today/today-actions.ts");
    const derived = read("lib/treatments/treatment-workspace-derived.ts");
    const calendar = read("features/calendar/AppointmentQuickView.tsx");

    expect(hook).toMatch(/useCustomerRemoteDetail/);
    expect(hook).toMatch(/getCustomerById/);
    expect(hook).not.toMatch(/findByPhone|name ===|phone ===/);
    expect(page).toMatch(/useTreatmentCustomerIdentity/);
    expect(page).not.toMatch(/getCustomerById|localCustomerRepository/);
    expect(list).toMatch(/useCustomerRemoteList/);
    expect(list).toMatch(/customerRemoteReadPilot[\s\S]*\? \(\[\] as Customer\[\]\)/);
    expect(detail).toMatch(/useTreatmentCustomerIdentity/);
    expect(detail).not.toMatch(/localCustomerRepository/);
    expect(snapshot).toMatch(/treatmentWorkspaceEntryHref/);
    expect(snapshot).toMatch(/pickRemoteAppointmentForCustomer/);
    const profile = read("features/customers/CustomerProfilePage.tsx");
    expect(profile).toMatch(/router\.push\(snapshot\.treatmentHref\)/);
    expect(profile).not.toMatch(/disabled=\{remoteReadPilot\}[\s\S]{0,80}開始療程/);
    expect(today).toMatch(/\/staff\/treatments\/new\?customer=\$\{appointment\.customerId\}/);
    expect(derived).toMatch(/\/staff\/treatments\/new\?customer=\$\{input\.customerId\}/);
    expect(calendar).toMatch(/resolveTodayPrimaryAction/);
    for (const file of [
      "app/staff/(app)/treatments/new/page.tsx",
      "app/staff/(app)/treatments/page.tsx",
      "app/staff/(app)/treatments/[id]/page.tsx",
    ]) {
      const source = read(file);
      expect(source).toMatch(/isCustomerRemoteReadPilotEnabled/);
      expect(source).not.toMatch(/customer-remote-read-pilot/);
    }
    expect(read("app/staff/(app)/treatments/new/page.tsx")).toMatch(
      /isAppointmentRemoteReadPilotEnabled/,
    );
  });

  it("does not copy remote customers into localStorage or invent a second identity", () => {
    const files = [
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/treatments/TreatmentDetailReadonly.tsx",
      "features/treatments/use-treatment-customer-identity.ts",
      "lib/treatments/treatment-identity.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/localCustomerRepository\.(upsert|create|save)/);
      expect(source).not.toMatch(/SEED_CUSTOMERS|mockCustomers\.push/);
      expect(source).not.toMatch(/createCustomer\(|buildRealCustomerCreate/);
    }
    const identity = read("lib/treatments/treatment-identity.ts");
    expect(identity).toMatch(/stay local-only/);
    expect(identity).toMatch(/must not copy customers/);
  });
});
