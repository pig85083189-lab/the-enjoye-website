/**
 * Phase 4.11C — Follow-up CRM tasks isolation & selectors.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { createEmptyDraft, saveCompletedTreatment } from "@/lib/treatment-draft";
import {
  listDueTodayFollowUps,
  listOverdueFollowUps,
  listUpcomingFollowUps,
} from "@/lib/follow-ups/selectors";
import {
  buildRebookHref,
  completeFollowUpTask,
  ensureFollowUpTaskFromCompletedTreatment,
  getFollowUpBySourceTreatment,
  getFollowUpTask,
  listFollowUpTasks,
  listFollowUpTasksForCustomer,
  snoozeFollowUpTask,
} from "@/lib/follow-ups/store";
import { NAVIGATION_ITEMS } from "@/lib/navigation/config";
import { getFollowUpTasksKey } from "@/lib/tenant/storage-keys";
import type { FollowUpTask } from "@/lib/follow-ups/domain";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function completedTreatmentWithFollowUp(overrides?: {
  id?: string;
  organizationId?: string;
  locationId?: string;
  customerId?: string;
  staffId?: string;
  suggestedDate?: string;
  suggestNextBooking?: boolean;
}) {
  const organizationId = overrides?.organizationId ?? ORG_ENJOYE_ID;
  const draft = createEmptyDraft({
    organizationId,
    locationId: overrides?.locationId ?? LOC_ENJOYE_PRIMARY_ID,
    appointmentId: `apt-${overrides?.id ?? "fu-1"}`,
    customerId: overrides?.customerId ?? "demo-001",
    staffId: overrides?.staffId ?? "staff-001",
    serviceId: "svc-breast",
  });
  if (overrides?.id) draft.id = overrides.id;
  draft.status = "completed";
  draft.followUp = {
    tags: ["右腋下"],
    suggestedDate: overrides?.suggestedDate ?? "2026-09-25",
    note: "下次確認緊繃",
    suggestNextBooking: overrides?.suggestNextBooking ?? false,
  };
  return draft;
}

describe("Treatment → FollowUpTask", () => {
  it("creates follow-up from completed treatment with intent", () => {
    const treatment = completedTreatmentWithFollowUp({ id: "t-create-1" });
    saveCompletedTreatment(treatment);
    const task = getFollowUpBySourceTreatment(ORG_ENJOYE_ID, treatment.id);
    expect(task).toBeTruthy();
    expect(task!.customerId).toBe("demo-001");
    expect(task!.sourceTreatmentId).toBe(treatment.id);
    expect(task!.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(task!.assignedStaffId).toBe("staff-001");
    expect(task!.status).toBe("OPEN");
    expect(task!.type).toBe("TREATMENT_FOLLOW_UP");
    expect(task!.context.followUpTags).toContain("右腋下");
  });

  it("is idempotent for same treatment", () => {
    const treatment = completedTreatmentWithFollowUp({ id: "t-idem-1" });
    const a = ensureFollowUpTaskFromCompletedTreatment(treatment);
    const b = ensureFollowUpTaskFromCompletedTreatment(treatment);
    saveCompletedTreatment(treatment);
    saveCompletedTreatment(treatment);
    const list = listFollowUpTasks(ORG_ENJOYE_ID).filter(
      (t) => t.sourceTreatmentId === treatment.id,
    );
    expect(a?.id).toBe(b?.id);
    expect(list).toHaveLength(1);
  });

  it("uses REBOOKING type when suggestNextBooking", () => {
    const treatment = completedTreatmentWithFollowUp({
      id: "t-rebook-type",
      suggestNextBooking: true,
    });
    const task = ensureFollowUpTaskFromCompletedTreatment(treatment);
    expect(task?.type).toBe("REBOOKING");
  });
});

describe("selectors: today / overdue / upcoming", () => {
  function task(partial: Partial<FollowUpTask> & { id: string; dueAt: string }): FollowUpTask {
    return {
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
      status: "OPEN",
      type: "TREATMENT_FOLLOW_UP",
      context: { followUpTags: [] },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      ...partial,
    };
  }

  const noonLocal = new Date(2026, 8, 25, 12, 0, 0); // Sep 25 2026 local

  it("lists due today", () => {
    const today = task({
      id: "fu-today",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
    });
    const tomorrow = task({
      id: "fu-tomorrow",
      dueAt: new Date(2026, 8, 26, 10, 0, 0).toISOString(),
    });
    expect(listDueTodayFollowUps([today, tomorrow], noonLocal).map((t) => t.id)).toEqual([
      "fu-today",
    ]);
  });

  it("lists overdue before local start of today", () => {
    const overdue = task({
      id: "fu-over",
      dueAt: new Date(2026, 8, 24, 23, 0, 0).toISOString(),
    });
    const today = task({
      id: "fu-today2",
      dueAt: new Date(2026, 8, 25, 9, 0, 0).toISOString(),
    });
    expect(listOverdueFollowUps([overdue, today], noonLocal).map((t) => t.id)).toEqual([
      "fu-over",
    ]);
  });

  it("lists upcoming after today", () => {
    const upcoming = task({
      id: "fu-up",
      dueAt: new Date(2026, 8, 27, 10, 0, 0).toISOString(),
    });
    const today = task({
      id: "fu-today3",
      dueAt: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
    });
    expect(listUpcomingFollowUps([upcoming, today], noonLocal).map((t) => t.id)).toEqual([
      "fu-up",
    ]);
  });
});

describe("complete / snooze / rebook", () => {
  it("completes and preserves history", () => {
    const treatment = completedTreatmentWithFollowUp({ id: "t-complete-1" });
    const created = ensureFollowUpTaskFromCompletedTreatment(treatment)!;
    const done = completeFollowUpTask(ORG_ENJOYE_ID, created.id, {
      actorStaffId: "staff-001",
      completionNote: "已電話聯繫",
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.completionNote).toBe("已電話聯繫");
    expect(done.completedAt).toBeTruthy();
    expect(listFollowUpTasks(ORG_ENJOYE_ID).some((t) => t.id === created.id)).toBe(true);
    expect(getFollowUpTask(ORG_ENJOYE_ID, created.id)?.status).toBe("COMPLETED");
  });

  it("snooze keeps OPEN and updates dueAt", () => {
    const treatment = completedTreatmentWithFollowUp({ id: "t-snooze-1" });
    const created = ensureFollowUpTaskFromCompletedTreatment(treatment)!;
    const nextDue = new Date(2026, 9, 1, 10, 0, 0).toISOString();
    const snoozed = snoozeFollowUpTask(ORG_ENJOYE_ID, created.id, {
      actorStaffId: "staff-001",
      dueAt: nextDue,
    });
    expect(snoozed.status).toBe("OPEN");
    expect(snoozed.dueAt).toBe(nextDue);
  });

  it("rebook href preserves customer (and optional service/staff)", () => {
    const treatment = completedTreatmentWithFollowUp({ id: "t-rebook-1" });
    const created = ensureFollowUpTaskFromCompletedTreatment(treatment)!;
    const href = buildRebookHref(created);
    expect(href).toContain("/staff/calendar?");
    expect(href).toContain("create=1");
    expect(href).toContain(`customer=${created.customerId}`);
    expect(href).toContain("service=");
    expect(href).toContain("staff=");
  });
});

describe("tenant isolation", () => {
  it("lists only by organization", () => {
    const a = completedTreatmentWithFollowUp({ id: "t-org-a" });
    ensureFollowUpTaskFromCompletedTreatment(a);
    expect(listFollowUpTasks(ORG_ENJOYE_ID).length).toBeGreaterThan(0);
    expect(listFollowUpTasks(ORG_LUMIERE_ID)).toHaveLength(0);
  });

  it("customer filtering is scoped", () => {
    const a = completedTreatmentWithFollowUp({
      id: "t-cust-a",
      customerId: "demo-001",
    });
    ensureFollowUpTaskFromCompletedTreatment(a);
    expect(listFollowUpTasksForCustomer(ORG_ENJOYE_ID, "demo-001").length).toBe(1);
    expect(listFollowUpTasksForCustomer(ORG_ENJOYE_ID, "demo-999")).toHaveLength(0);
  });

  it("rejects cross-org read / update", () => {
    const a = completedTreatmentWithFollowUp({ id: "t-xorg-1" });
    const created = ensureFollowUpTaskFromCompletedTreatment(a)!;
    expect(getFollowUpTask(ORG_LUMIERE_ID, created.id)).toBeUndefined();
    expect(() =>
      completeFollowUpTask(ORG_LUMIERE_ID, created.id, {
        actorStaffId: "staff-lumiere-01",
      }),
    ).toThrow();
    expect(() =>
      snoozeFollowUpTask(ORG_LUMIERE_ID, created.id, {
        actorStaffId: "staff-lumiere-01",
        dueAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("same-id cross-org isolation", () => {
    const sharedTreatmentId = "treatment-shared-fu";
    const enjoye = completedTreatmentWithFollowUp({
      id: sharedTreatmentId,
      organizationId: ORG_ENJOYE_ID,
      customerId: "demo-001",
    });
    enjoye.id = sharedTreatmentId;
    ensureFollowUpTaskFromCompletedTreatment(enjoye);

    const lumiere = completedTreatmentWithFollowUp({
      id: sharedTreatmentId,
      organizationId: ORG_LUMIERE_ID,
      locationId: undefined,
      customerId: "lumiere-guest",
      staffId: "staff-lumiere-01",
    });
    lumiere.id = sharedTreatmentId;
    lumiere.serviceId = "svc-facial";
    ensureFollowUpTaskFromCompletedTreatment(lumiere);

    const a = getFollowUpBySourceTreatment(ORG_ENJOYE_ID, sharedTreatmentId)!;
    const b = getFollowUpBySourceTreatment(ORG_LUMIERE_ID, sharedTreatmentId)!;
    expect(a.id).toBe(b.id); // deterministic id same
    expect(a.organizationId).toBe(ORG_ENJOYE_ID);
    expect(b.organizationId).toBe(ORG_LUMIERE_ID);
    expect(a.customerId).not.toBe(b.customerId);
    expect(localStorage.getItem(getFollowUpTasksKey(ORG_ENJOYE_ID))).toContain(
      ORG_ENJOYE_ID,
    );
    expect(localStorage.getItem(getFollowUpTasksKey(ORG_LUMIERE_ID))).toContain(
      ORG_LUMIERE_ID,
    );
  });

  it("preserves source location and assignee ownership", () => {
    const treatment = completedTreatmentWithFollowUp({
      id: "t-loc-1",
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
    });
    const task = ensureFollowUpTaskFromCompletedTreatment(treatment)!;
    expect(task.locationId).toBe(LOC_ENJOYE_PRIMARY_ID);
    expect(task.assignedStaffId).toBe("staff-001");

    const badStaff = completedTreatmentWithFollowUp({
      id: "t-bad-staff",
      staffId: "staff-lumiere-01",
    });
    const unassigned = ensureFollowUpTaskFromCompletedTreatment(badStaff)!;
    expect(unassigned.assignedStaffId).toBeUndefined();
  });

  it("customer profile listing never leaks other customers", () => {
    ensureFollowUpTaskFromCompletedTreatment(
      completedTreatmentWithFollowUp({ id: "t-c1", customerId: "demo-001" }),
    );
    ensureFollowUpTaskFromCompletedTreatment(
      completedTreatmentWithFollowUp({ id: "t-c2", customerId: "demo-002" }),
    );
    const only001 = listFollowUpTasksForCustomer(ORG_ENJOYE_ID, "demo-001");
    expect(only001.every((t) => t.customerId === "demo-001")).toBe(true);
    expect(only001.some((t) => t.customerId === "demo-002")).toBe(false);
  });
});

describe("navigation", () => {
  it("follow-ups is ready", () => {
    const item = NAVIGATION_ITEMS.find((i) => i.id === "follow-ups")!;
    expect(item.status).toBe("ready");
    expect(item.label).toBe("追蹤");
  });
});
