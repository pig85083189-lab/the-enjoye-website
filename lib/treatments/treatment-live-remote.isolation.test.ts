import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  LOC_B1,
  ORG_A,
  ORG_B,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "@/lib/persistence/test-identity-fixture";
import {
  TreatmentCompletedImmutableError,
  TreatmentDuplicateError,
  TreatmentWritePilotDeniedError,
  TreatmentWriteZeroRowError,
  assertTreatmentWriteRole,
  isTreatmentRemoteWritePilotEnabled,
  runAuthenticatedTreatmentCreate,
} from "@/lib/treatments/treatment-remote-write-pilot";
import { TREATMENT_REMOTE_READ_PILOT_ENV } from "@/lib/treatments/treatment-remote-read-flag";
import { TREATMENT_REMOTE_WRITE_PILOT_ENV } from "@/lib/treatments/treatment-remote-write-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";
import {
  isRawServiceId,
  resolveCanonicalCustomerDisplayName,
  resolveCanonicalServiceDisplayName,
  resolveTreatmentTemplateLabel,
  resolveCanonicalStaffDisplayName,
} from "@/lib/treatments/treatment-display";
import {
  isMutedAppointmentStatus,
  shouldCreateTreatmentForAppointment,
  presentAppointmentStatusFromTreatment,
  todayBucketFromTreatment,
} from "@/lib/treatments/treatment-today";
import { resolveTodayPrimaryAction } from "@/lib/today/today-actions";
import { createEmptyDraft } from "@/lib/treatment-draft";
import type { TreatmentDraft } from "@/types/treatment";
import type { Appointment } from "@/types";

const WRITE_ON = {
  [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
  [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
};

const START = "2026-10-01T02:00:00.000Z";
const END = "2026-10-01T03:00:00.000Z";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function source(rel: string): string {
  expect(existsSync(path.join(process.cwd(), rel)), rel).toBe(true);
  return read(rel);
}

async function seedAppointment(
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"],
  id = "apt-live01-abcdef",
) {
  return remote.appointments.create(ORG_A, {
    id,
    locationId: LOC_A1,
    customerId: CUST_SHARED,
    serviceId: SVC_SHARED,
    staffId: STAFF_A,
    startAt: START,
    endAt: END,
    createdBy: STAFF_A,
    customerName: "真實客人",
    serviceName: "美胸",
    staffName: "怡蓁",
  });
}

function draftFor(appointmentId: string, treatmentId: string): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG_A,
      locationId: LOC_A1,
      appointmentId,
      customerId: CUST_SHARED,
      staffId: STAFF_A,
      serviceId: SVC_SHARED,
    }),
    id: treatmentId,
    professionalNote: "草稿備註",
  };
}

const appointment: Appointment = {
  id: "apt-1",
  organizationId: ORG_A,
  locationId: LOC_A1,
  customerId: CUST_SHARED,
  customerName: "真實客人",
  serviceId: SVC_SHARED,
  serviceName: "美胸",
  durationMinutes: 100,
  time: "10:00",
  status: "pending",
  membership: "regular",
  notes: [],
  staffId: STAFF_A,
  staffName: "怡蓁",
};

describe("Phase 1C-6G.1 live Treatment remote wiring", () => {
  it("1. Pilot OFF keeps local mode", () => {
    expect(isTreatmentRemoteReadPilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({})).toBe(false);
    const hook = source("hooks/useTreatmentDraft.ts");
    expect(hook).toMatch(/if \(!remoteRead\)/);
    expect(hook).toMatch(/loadDraft\(/);
    expect(hook).toMatch(/saveDraft\(/);
    expect(hook).toMatch(/saveCompletedTreatment\(/);
  });

  it("2. Pilot ON does not read local Treatment", () => {
    const list = source("features/treatments/TreatmentsListPageClient.tsx");
    const detail = source("features/treatments/TreatmentDetailReadonly.tsx");
    const tab = source("features/customers/tabs/TreatmentsTab.tsx");
    const snapshot = source("features/customers/use-customer-360.ts");
    expect(list).toMatch(/treatmentRemoteReadPilot/);
    expect(list).toMatch(/useTreatmentRemoteList/);
    expect(list).toMatch(/listOpenTreatmentDrafts/);
    expect(detail).toMatch(/useTreatmentRemoteDetail/);
    expect(detail).toMatch(/treatmentRemoteReadPilot[\s\S]*\? null/);
    expect(tab).toMatch(/useTreatmentRemoteListByCustomer/);
    expect(tab).toMatch(/localTreatmentRepository\.listByCustomer/);
    expect(snapshot).toMatch(/remoteTreatments != null/);
  });

  it("3. Pilot ON does not write localStorage", () => {
    const hook = source("hooks/useTreatmentDraft.ts");
    const write = source("features/treatments/use-treatment-remote-write.ts");
    expect(hook).toMatch(/if \(remoteRead && !remoteWrite\) \{\s*return;/);
    expect(hook).toMatch(/submitTreatmentRemoteAutosave/);
    expect(hook).toMatch(/submitTreatmentRemoteComplete/);
    expect(write).not.toMatch(/saveDraft\(|saveCompletedTreatment\(|localStorage/);
    expect(write).toMatch(/\[TREATMENT_REMOTE_WRITE_PILOT_ENV\]:\s*"1"/);
    expect(write).toMatch(/\[TREATMENT_REMOTE_READ_PILOT_ENV\]:\s*"1"/);
    expect(write).toMatch(/treatmentWritePilotEnv/);
    expect(source("features/treatments/use-treatment-remote-read.ts")).toMatch(
      /\[TREATMENT_REMOTE_READ_PILOT_ENV\]:\s*"1"/,
    );
    expect(hook).toMatch(/treatmentReadPilotEnv/);
    expect(hook).toMatch(/skipNextSave\.current = true/);
    expect(hook).toMatch(/if \(!draft\.id\.startsWith\("trt-"\)\) return;/);
    expect(hook).toMatch(/expectedUpdatedAt/);
  });

  it("4-10. remote create, uniqueness, OCC, stale, complete, no DRAFT return", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointmentRow = await seedAppointment(remote);
    const created = await remote.treatments.create(ORG_A, {
      id: "trt-live01-abcdef",
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointmentRow.id,
      createdBy: STAFF_A,
    });
    expect(created.id).toBe("trt-live01-abcdef");
    expect(created.status).toBe("draft");
    expect(created.staffId).toBe(STAFF_A);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-live02-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointmentRow.id,
      }),
    ).rejects.toBeInstanceOf(TreatmentDuplicateError);

    const saved = await remote.treatments.update(ORG_A, {
      treatmentId: created.id,
      expectedUpdatedAt: created.updatedAt,
      updatedBy: STAFF_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointmentRow.id,
      draft: draftFor(appointmentRow.id, created.id),
    });
    expect(saved.updatedAt).not.toBe(created.updatedAt);
    await expect(
      remote.treatments.update(ORG_A, {
        treatmentId: created.id,
        expectedUpdatedAt: created.updatedAt,
        updatedBy: STAFF_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointmentRow.id,
        draft: draftFor(appointmentRow.id, created.id),
      }),
    ).rejects.toBeInstanceOf(TreatmentWriteZeroRowError);

    const completed = await remote.treatments.complete(ORG_A, {
      treatmentId: created.id,
      expectedUpdatedAt: saved.updatedAt,
      updatedBy: STAFF_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: appointmentRow.id,
      draft: draftFor(appointmentRow.id, created.id),
    });
    expect(completed.status).toBe("completed");
    await expect(
      remote.treatments.update(ORG_A, {
        treatmentId: created.id,
        expectedUpdatedAt: completed.updatedAt,
        updatedBy: STAFF_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointmentRow.id,
        draft: draftFor(appointmentRow.id, created.id),
      }),
    ).rejects.toBeInstanceOf(TreatmentCompletedImmutableError);
    const listed = await remote.treatments.listByCustomerId(ORG_A, CUST_SHARED);
    expect(listed.map((item) => item.id)).toEqual(["trt-live01-abcdef"]);
    expect(listed[0]?.status).toBe("completed");
    const all = await remote.treatments.list(ORG_A);
    expect(all.map((item) => item.id)).toEqual(["trt-live01-abcdef"]);
  });

  it("8. network failure does not mark success or fallback", () => {
    const hook = source("hooks/useTreatmentDraft.ts");
    expect(hook).toMatch(/setSaveError/);
    expect(hook).toMatch(/if \(!remoteRead\) \{[\s\S]*saveDraft\(draft\);\s*setSavedAt\(new Date\(\)\)/);
    expect(hook).toMatch(/} catch \(error: unknown\) \{[\s\S]*setSaveError/);
    expect(hook).not.toMatch(/saveDraft\(draft\);\s*setSavedAt\(new Date\(saved/);
  });

  it("11-12. Customer 360 and Treatments list remote readback", () => {
    expect(source("features/customers/tabs/TreatmentsTab.tsx")).toMatch(
      /useTreatmentRemoteListByCustomer/,
    );
    expect(source("features/customers/CustomerProfilePage.tsx")).toMatch(
      /treatmentRemoteReadPilot/,
    );
    expect(source("features/treatments/TreatmentsListPageClient.tsx")).toMatch(
      /useTreatmentRemoteList/,
    );
    expect(source("features/treatments/TreatmentsListPageClient.tsx")).toMatch(
      /data-treatment-record-source=\{treatmentRemoteReadPilot \? "remote-pilot" : "local"\}/,
    );
  });

  it("13. Today 待服務 → 服務中 → 已完成 derivation", () => {
    expect(todayBucketFromTreatment("BOOKED")).toBe("waiting");
    expect(todayBucketFromTreatment("CONFIRMED", null)).toBe("waiting");
    expect(todayBucketFromTreatment("ARRIVED")).toBe("waiting");
    expect(todayBucketFromTreatment("BOOKED", "draft")).toBe("active");
    expect(todayBucketFromTreatment("IN_SERVICE", "draft")).toBe("active");
    expect(todayBucketFromTreatment("BOOKED", "completed")).toBe("done");
    expect(todayBucketFromTreatment("COMPLETED", "completed")).toBe("done");
    expect(presentAppointmentStatusFromTreatment("BOOKED", "completed")).toBe(
      "COMPLETED",
    );
    expect(presentAppointmentStatusFromTreatment("BOOKED", "draft")).toBe(
      "IN_SERVICE",
    );
    expect(resolveTodayPrimaryAction(appointment, "BOOKED", {
      treatmentRemoteRead: true,
      remoteTreatment: null,
    }).kind).toBe("start_treatment");
    expect(resolveTodayPrimaryAction(appointment, "BOOKED", {
      treatmentRemoteRead: true,
      remoteTreatment: { ...draftFor("apt-1", "trt-1"), status: "draft" },
    }).kind).toBe("continue_treatment");
    const completedAction = resolveTodayPrimaryAction(appointment, "BOOKED", {
      treatmentRemoteRead: true,
      remoteTreatment: { ...draftFor("apt-1", "trt-1"), status: "completed", id: "trt-1" },
    });
    expect(["view_record", "checkout", "none"]).toContain(completedAction.kind);
    if (completedAction.kind === "view_record") {
      expect(completedAction.href).toContain("/staff/treatments/trt-1");
    }
  });

  it("14. CANCELLED / NO_SHOW do not create Treatment and stay muted", () => {
    expect(isMutedAppointmentStatus("CANCELLED")).toBe(true);
    expect(isMutedAppointmentStatus("NO_SHOW")).toBe(true);
    expect(shouldCreateTreatmentForAppointment("CANCELLED")).toBe(false);
    expect(shouldCreateTreatmentForAppointment("BOOKED")).toBe(true);
    expect(todayBucketFromTreatment("CANCELLED", "draft")).toBe("muted");
    expect(todayBucketFromTreatment("NO_SHOW")).toBe("muted");
    expect(resolveTodayPrimaryAction(appointment, "CANCELLED").kind).toBe("none");
    expect(resolveTodayPrimaryAction(appointment, "NO_SHOW").kind).toBe("none");
    expect(source("hooks/useTreatmentDraft.ts")).toMatch(
      /shouldCreateTreatmentForAppointment/,
    );
    expect(source("features/treatments/TreatmentPageClient.tsx")).toMatch(
      /isMutedAppointmentStatus/,
    );
  });

  it("15-16. canonical service / staff / customer display never shows raw ids", () => {
    expect(isRawServiceId("svc-muqm5pht-nqlpr3")).toBe(true);
    expect(resolveCanonicalServiceDisplayName({
      serviceId: "svc-muqm5pht-nqlpr3",
      catalogName: undefined,
      snapshotName: "svc-muqm5pht-nqlpr3",
    })).toBe("療程");
    expect(resolveCanonicalServiceDisplayName({
      serviceId: "svc-muqm5pht-nqlpr3",
      catalogName: "Remote QA Service",
    })).toBe("Remote QA Service");
    expect(resolveCanonicalStaffDisplayName({
      staffId: "staff-001",
      snapshotName: "staff-001",
    })).toBe("—");
    expect(resolveCanonicalStaffDisplayName({
      staffId: "staff-001",
      rosterName: "怡蓁",
    })).toBe("怡蓁");
    expect(resolveCanonicalCustomerDisplayName({
      customerId: "cust-remote-qa",
      snapshotName: "cust-remote-qa",
    })).toBe("客戶");
    expect(resolveCanonicalCustomerDisplayName({
      customerId: "cust-remote-qa",
      catalogName: "Remote QA Customer",
    })).toBe("Remote QA Customer");
    expect(resolveTreatmentTemplateLabel({
      serviceId: "svc-muqm5pht-nqlpr3",
      snapshotName: "Remote QA Bust Care",
    })).toBe("Remote QA Bust Care 療程模板");
    expect(resolveTreatmentTemplateLabel({
      serviceId: "svc-muqm5pht-nqlpr3",
      snapshotName: "svc-muqm5pht-nqlpr3",
    })).toBe("通用療程模板");
    const workspace = source("features/treatments/TreatmentWorkspace.tsx");
    expect(workspace).toMatch(/resolveTreatmentTemplateLabel/);
    expect(workspace).not.toMatch(/目前使用通用療程模板|尚未寫入遠端|試點|RLS|OCC|Supabase/);
    expect(source("components/treatments/AutoSaveIndicator.tsx")).toMatch(/儲存中…/);
    expect(source("components/treatments/AutoSaveIndicator.tsx")).toMatch(/✓ 已自動儲存/);
    expect(source("components/treatments/AutoSaveIndicator.tsx")).toMatch(/儲存失敗，請重試/);
    expect(source("components/appointments/NextCustomerPanel.tsx")).not.toMatch(
      /今日遠端讀取試點為唯讀/,
    );
    expect(source("components/appointments/AppointmentCard.tsx")).not.toMatch(
      /今日遠端讀取試點為唯讀/,
    );
    expect(source("features/customers/CustomerProfilePage.tsx")).not.toMatch(
      /僅供內部服務紀錄使用/,
    );
    const derived = source("lib/treatments/treatment-workspace-derived.ts");
    expect(derived).toMatch(/resolveCanonicalServiceDisplayName/);
    expect(derived).not.toMatch(/serviceName: service\?\.name \|\| appointment\?\.serviceName \|\| serviceId/);
  });

  it("17-18. cross-org and cross-location denied", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const appointmentRow = await seedAppointment(remote);
    await expect(
      remote.treatments.create(ORG_B, {
        id: "trt-live03-abcdef",
        locationId: LOC_B1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointmentRow.id,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-live04-abcdef",
        locationId: LOC_B1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: appointmentRow.id,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("19. Auth UUID is rejected as operational staff", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const { staffA } = seedTwoOrgs(db);
    const appointmentRow = await seedAppointment(remote);
    await expect(
      remote.treatments.create(ORG_A, {
        id: "trt-live05-abcdef",
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: staffA.authUserId!,
        appointmentId: appointmentRow.id,
      }),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
  });

  it("20. ACCOUNTANT denied", () => {
    expect(() => assertTreatmentWriteRole({ role: "ACCOUNTANT", isActive: true })).toThrow(
      TreatmentWritePilotDeniedError,
    );
    for (const role of ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"] as const) {
      expect(() => assertTreatmentWriteRole({ role, isActive: true })).not.toThrow();
    }
  });

  it("21. existing Customer / Appointment / Staff remote flows stay independent", () => {
    expect(source("lib/treatments/treatment-remote-read-flag.ts")).toMatch(
      /Independent of BEAUTY_OS_PERSISTENCE/,
    );
    expect(source("hooks/useTreatmentDraft.ts")).not.toMatch(
      /BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE|createServiceRoleClient/,
    );
    expect(isTreatmentRemoteReadPilotEnabled({
      BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
    })).toBe(false);
    void runAuthenticatedTreatmentCreate;
    void WRITE_ON;
  });
});
