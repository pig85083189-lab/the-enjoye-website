import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  assertCommerceCheckoutReadRole,
  buildCommerceCheckoutCandidate,
  buildCommerceCheckoutHref,
  COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE,
  resolveCommerceCheckoutEligibility,
  toCreateRemoteCheckoutDraftInput,
} from "./commerce-remote-identity";
import {
  buildRemoteCommerceCheckoutItems,
  toRemoteCommerceCheckoutItem,
} from "./checkout-workspace-derived";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import { createEmptyDraft } from "@/lib/treatment-draft";
import {
  isRawAppointmentId,
  isRawCustomerId,
  isRawServiceId,
  isRawStaffId,
  isRawTreatmentId,
} from "@/lib/treatments/treatment-display";
import type { Customer, Service } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";
import type { Appointment } from "@/types";

const ORG = "org-the-enjoye";
const OTHER_ORG = "org-lumiere";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function appointment(
  over: Partial<ScheduleAppointment> = {},
): ScheduleAppointment {
  return {
    id: "apt-muqrindw-yt0l5z",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-muqh2jn6-xpjssl",
    customerName: "Remote QA Customer",
    serviceId: "svc-muqm5pht-nqlpr3",
    serviceName: "Remote QA Bust Care",
    staffId: "staff-001",
    staffName: "測試帳號",
    startAt: "2026-10-09T02:00:00.000Z",
    endAt: "2026-10-09T03:40:00.000Z",
    durationMinutes: 100,
    status: "COMPLETED",
    notes: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

function treatment(over: Partial<TreatmentDraft> = {}): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG,
      locationId: "loc-enjoye-main",
      appointmentId: "apt-muqrindw-yt0l5z",
      customerId: "cust-muqh2jn6-xpjssl",
      staffId: "staff-001",
      serviceId: "svc-muqm5pht-nqlpr3",
    }),
    id: "trt-muqident-yyyyyy",
    status: "completed",
    ...over,
  };
}

function customer(): Customer {
  return {
    id: "cust-muqh2jn6-xpjssl",
    organizationId: ORG,
    name: "Remote QA Customer",
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
    joinedAt: "2026-10-01",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function service(): Service {
  return {
    id: "svc-muqm5pht-nqlpr3",
    organizationId: ORG,
    name: "Remote QA Bust Care",
    durationMinutes: 100,
    category: "美胸",
    serviceType: "BREAST",
    isActive: true,
  };
}

function todayAppointment(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-muqrindw-yt0l5z",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-muqh2jn6-xpjssl",
    customerName: "Remote QA Customer",
    serviceId: "svc-muqm5pht-nqlpr3",
    serviceName: "Remote QA Bust Care",
    durationMinutes: 100,
    time: "10:00",
    status: "completed",
    membership: "new",
    notes: [],
    staffId: "staff-001",
    staffName: "測試帳號",
    ...over,
  };
}

describe("Phase 1C-6H.1 commerce remote identity", () => {
  it("keeps Customer / Appointment / Treatment / Service on canonical ids", () => {
    const candidate = buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment(),
      treatment: treatment(),
      customer: customer(),
      service: service(),
    });
    expect(candidate).not.toBeNull();
    expect(candidate?.identity).toEqual({
      organizationId: ORG,
      customerId: "cust-muqh2jn6-xpjssl",
      appointmentId: "apt-muqrindw-yt0l5z",
      treatmentId: "trt-muqident-yyyyyy",
      serviceId: "svc-muqm5pht-nqlpr3",
      staffId: "staff-001",
      locationId: "loc-enjoye-main",
    });
    expect(isRawCustomerId(candidate!.identity.customerId)).toBe(true);
    expect(isRawAppointmentId(candidate!.identity.appointmentId)).toBe(true);
    expect(isRawTreatmentId(candidate!.identity.treatmentId)).toBe(true);
    expect(isRawServiceId(candidate!.identity.serviceId)).toBe(true);
    expect(candidate?.customerName).toBe("Remote QA Customer");
    expect(candidate?.serviceName).toBe("Remote QA Bust Care");
    expect(candidate?.staffName).toBe("測試帳號");
    expect(isRawCustomerId(candidate!.customerName)).toBe(false);
    expect(isRawServiceId(candidate!.serviceName)).toBe(false);
    expect(isRawStaffId(candidate!.staffName)).toBe(false);
    expect(candidate?.href).toBe(
      "/staff/checkout?appointment=apt-muqrindw-yt0l5z&treatment=trt-muqident-yyyyyy",
    );
  });

  it("never shows raw ids when catalog / snapshot only has ids", () => {
    const candidate = buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment({
        customerName: "cust-muqh2jn6-xpjssl",
        serviceName: "svc-muqm5pht-nqlpr3",
        staffName: "staff-001",
      }),
      treatment: treatment(),
      customer: { ...customer(), name: "cust-muqh2jn6-xpjssl" },
      service: { ...service(), name: "svc-muqm5pht-nqlpr3" },
    });
    expect(candidate?.customerName).toBe("客戶");
    expect(candidate?.serviceName).toBe("療程");
    expect(candidate?.staffName).toBe("—");
    const item = toRemoteCommerceCheckoutItem(candidate!);
    expect(item.customerName).toBe("客戶");
    expect(item.serviceName).toBe("療程");
    expect(item.status.title).toBe("待結帳");
    expect(item.appointment).toBeNull();
    expect(item.draft).toBeNull();
    expect(item.transaction).toBeNull();
  });

  it("marks COMPLETED Treatment eligible and everything else closed", () => {
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "COMPLETED",
        treatmentStatus: "completed",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "IN_SERVICE",
        treatmentStatus: "COMPLETED",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }).eligible,
    ).toBe(true);
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "COMPLETED",
        treatmentStatus: "draft",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: false, reason: "treatment_draft" });
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "COMPLETED",
        appointmentId: "apt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: false, reason: "no_treatment" });
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "CANCELLED",
        treatmentStatus: "completed",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: false, reason: "appointment_cancelled" });
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "NO_SHOW",
        treatmentStatus: "completed",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: false, reason: "appointment_no_show" });
    expect(
      resolveCommerceCheckoutEligibility({
        appointmentStatus: "DRAFT",
        treatmentStatus: "completed",
        appointmentId: "apt-1",
        treatmentId: "trt-1",
        customerId: "cust-1",
        serviceId: "svc-1",
      }),
    ).toEqual({ eligible: false, reason: "appointment_draft" });
    expect(buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment({ status: "CANCELLED" }),
      treatment: treatment(),
    })).toBeNull();
    expect(buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment(),
      treatment: treatment({ status: "draft" }),
    })).toBeNull();
    expect(buildCommerceCheckoutCandidate({
      organizationId: OTHER_ORG,
      appointment: appointment(),
      treatment: treatment(),
    })).toBeNull();
  });

  it("does not use an empty local transaction store to decide identity", () => {
    expect(localStorage.getItem("beauty-os:transactions")).toBeNull();
    const candidate = buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment(),
      treatment: treatment(),
      customer: customer(),
      service: service(),
    });
    expect(candidate?.href).toContain("/staff/checkout?appointment=apt-muqrindw-yt0l5z");
    const items = buildRemoteCommerceCheckoutItems([candidate!]);
    expect(items).toHaveLength(1);
    expect(items[0]?.paid).toBe(false);
    expect(items[0]?.transaction).toBeNull();
  });

  it("keeps checkout roles and denies ACCOUNTANT", () => {
    expect(() => assertCommerceCheckoutReadRole({ role: "OWNER", isActive: true })).not.toThrow();
    expect(() => assertCommerceCheckoutReadRole({ role: "MANAGER", isActive: true })).not.toThrow();
    expect(() => assertCommerceCheckoutReadRole({ role: "STAFF", isActive: true })).not.toThrow();
    expect(() =>
      assertCommerceCheckoutReadRole({ role: "RECEPTIONIST", isActive: true }),
    ).not.toThrow();
    expect(() => assertCommerceCheckoutReadRole({ role: "ACCOUNTANT", isActive: true })).toThrow(
      COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE,
    );
    expect(() => assertCommerceCheckoutReadRole({ role: "OWNER", isActive: false })).toThrow(
      COMMERCE_CHECKOUT_FORBIDDEN_MESSAGE,
    );
  });

  it("builds next-phase CheckoutDraft input without persisting", () => {
    const candidate = buildCommerceCheckoutCandidate({
      organizationId: ORG,
      appointment: appointment(),
      treatment: treatment(),
    });
    const input = toCreateRemoteCheckoutDraftInput({
      identity: candidate!.identity,
      createdByStaffId: "staff-001",
    });
    expect(input).toEqual({
      organizationId: ORG,
      appointmentId: "apt-muqrindw-yt0l5z",
      treatmentId: "trt-muqident-yyyyyy",
      customerId: "cust-muqh2jn6-xpjssl",
      serviceId: "svc-muqm5pht-nqlpr3",
      locationId: "loc-enjoye-main",
      createdByStaffId: "staff-001",
    });
    expect(read("lib/commerce/commerce-remote-identity.ts")).not.toMatch(
      /createCheckoutFromAppointment|listCheckoutDrafts|completeCheckout/,
    );
  });

  it("Today commerce CTA uses Treatment COMPLETED and ignores local TX nav", () => {
    const completed = treatment();
    const action = resolveTodayPrimaryAction(todayAppointment(), "COMPLETED", {
      treatmentRemoteRead: true,
      commerceRemoteRead: true,
      remoteTreatment: completed,
    });
    expect(action).toEqual({
      kind: "checkout",
      href: buildCommerceCheckoutHref({
        appointmentId: "apt-muqrindw-yt0l5z",
        treatmentId: "trt-muqident-yyyyyy",
      }),
      label: "前往結帳",
    });
    expect(
      resolveTodayPrimaryAction(todayAppointment({ status: "in_progress" }), "IN_SERVICE", {
        treatmentRemoteRead: true,
        commerceRemoteRead: true,
        remoteTreatment: treatment({ status: "draft" }),
      }).kind,
    ).toBe("continue_treatment");
    expect(
      resolveTodayPrimaryAction(todayAppointment(), "CANCELLED", {
        commerceRemoteRead: true,
        remoteTreatment: completed,
      }).kind,
    ).toBe("none");
    expect(
      resolveTodayPrimaryAction(todayAppointment(), "COMPLETED", {
        commerceRemoteRead: true,
        remoteTreatment: completed,
        allowCheckout: false,
      }),
    ).toEqual({
      kind: "view_record",
      href: "/staff/treatments/trt-muqident-yyyyyy",
      label: "查看紀錄",
    });
  });
});
