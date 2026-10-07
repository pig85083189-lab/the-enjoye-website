import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  MEMBERSHIP_OVERRIDES_STORAGE_KEY,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  createMembership,
  listLocations,
  listMemberships,
  updateMembership,
} from "@/lib/tenant/organization-store";
import { listBookableStaff, listWorkingHours } from "@/lib/staff-schedule/store";
import * as staffSchedule from "@/lib/staff-schedule/store";
import { buildStaffWorkspace } from "./staff-workspace-derived";
import {
  STAFF_HAS_SECOND_AVAILABILITY_CALCULATOR,
  STAFF_HAS_SECOND_SCHEDULE_STORE,
} from "./staff-workspace-derived";
import {
  applyOnboardingHoursPattern,
  canManageStaff,
  defaultOnboardingHours,
  emptyOnboardingDraft,
  planOnboardingWorkingHours,
  STAFF_HAS_AUTH_ACCOUNT_CREATE,
  STAFF_HAS_EMPLOYEE_DOMAIN,
  STAFF_HAS_SECOND_MEMBERSHIP_STORE,
  STAFF_ONBOARDING_ROLES,
  STAFF_ROLE_PRESENTATION,
  staffOnboardingIdentityPrefixes,
  validateOnboardingDraft,
  validateOnboardingStep1,
  validateOnboardingStep2,
  validateOnboardingStep3,
  type StaffOnboardingDraft,
} from "./staff-onboarding-derived";
import {
  createStaffOnboarding,
  createStaffOnboardingFromDraft,
} from "./staff-onboarding";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date(2026, 8, 29, 11, 0, 0);

function basicDraft(over: Partial<StaffOnboardingDraft> = {}): StaffOnboardingDraft {
  return {
    ...emptyOnboardingDraft(LOC_ENJOYE_PRIMARY_ID),
    displayName: "林新進",
    role: "STAFF",
    scheduleMode: "later",
    ...over,
  };
}

function workspaceFor(organizationId: string, locationId: string, locationName: string) {
  const memberships = listMemberships(organizationId);
  return buildStaffWorkspace({
    organizationId,
    locationId,
    locationName,
    memberships,
    workingHours: listWorkingHours(organizationId, { locationId }),
    breaks: [],
    timeOff: [],
    now: NOW,
  });
}

describe("A–E create membership", () => {
  it("A creates membership only in the target organization", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "林新進",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    expect(created.organizationId).toBe(ORG_ENJOYE_ID);
    expect(listMemberships(ORG_ENJOYE_ID).some((item) => item.id === created.id)).toBe(true);
    expect(listMemberships(ORG_LUMIERE_ID).some((item) => item.id === created.id)).toBe(false);
  });

  it("B persists the submitted locationIds", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "雙店員工",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID],
    });
    expect(created.locationIds).toEqual([LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID]);
  });

  it("C only accepts canonical StaffRole values", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "櫃台新人",
      role: "RECEPTIONIST",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    expect(STAFF_ONBOARDING_ROLES).toEqual([
      "OWNER",
      "MANAGER",
      "STAFF",
      "RECEPTIONIST",
      "ACCOUNTANT",
    ]);
    expect(created.role).toBe("RECEPTIONIST");
    expect(STAFF_ROLE_PRESENTATION.RECEPTIONIST).toBe("櫃台");
    expect(() =>
      createMembership({
        organizationId: ORG_ENJOYE_ID,
        displayName: "假角色",
        role: "THERAPIST" as never,
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
      }),
    ).toThrow(/canonical StaffRole/);
  });

  it("D trims displayName and refuses blank names", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "  林新進  ",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    expect(created.displayName).toBe("林新進");
    expect(validateOnboardingStep1(basicDraft({ displayName: "   " }))).toBe("請填寫員工姓名");
  });

  it("E defaults new membership to active", () => {
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "在職新人",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    expect(created.isActive).toBe(true);
  });
});

describe("F identity + G schedule staffId", () => {
  it("F uses existing newId prefixes for membership id and userId", () => {
    const prefixes = staffOnboardingIdentityPrefixes();
    expect(prefixes).toEqual({ membership: "mem", user: "staff" });
    const created = createMembership({
      organizationId: ORG_ENJOYE_ID,
      displayName: "識別新人",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
    });
    expect(created.id).toMatch(/^mem-[0-9a-z]+-[0-9a-z]+$/);
    expect(created.userId).toMatch(/^staff-[0-9a-z]+-[0-9a-z]+$/);
    expect(created.id).not.toBe(created.userId);
    expect(created.userId).not.toBe(created.displayName);
  });

  it("G writes working hours against membership.userId", () => {
    const draft = basicDraft({
      scheduleMode: "basic",
      hours: applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-fri"),
    });
    const result = createStaffOnboardingFromDraft(ORG_ENJOYE_ID, draft);
    expect(result.scheduleError).toBeNull();
    const hours = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: result.membership.userId,
    });
    expect(hours.every((item) => item.staffId === result.membership.userId)).toBe(true);
    expect(hours.some((item) => item.staffId === result.membership.id)).toBe(false);
  });
});

describe("H–J initial schedule mapping", () => {
  it("H Monday–Friday preset marks Sat/Sun off", () => {
    const hours = applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-fri");
    const working = hours.filter((item) => item.isWorking).map((item) => item.dayOfWeek);
    expect(working).toEqual([1, 2, 3, 4, 5]);
    expect(hours.find((item) => item.dayOfWeek === 6)?.isWorking).toBe(false);
    expect(hours.find((item) => item.dayOfWeek === 0)?.isWorking).toBe(false);
  });

  it("I Monday–Saturday preset leaves Sunday off", () => {
    const hours = applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-sat");
    expect(hours.filter((item) => item.isWorking).map((item) => item.dayOfWeek)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(hours.find((item) => item.dayOfWeek === 0)?.isWorking).toBe(false);
  });

  it("J off days persist as isWorking=false instead of invalid times", () => {
    const draft = basicDraft({
      scheduleMode: "basic",
      hours: applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-fri"),
    });
    const result = createStaffOnboardingFromDraft(ORG_ENJOYE_ID, draft);
    const hours = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: result.membership.userId,
    });
    const sunday = hours.find((item) => item.dayOfWeek === 0);
    expect(sunday).toBeTruthy();
    expect(sunday?.isWorking).toBe(false);
    if (sunday) {
      expect(sunday.isWorking || sunday.startTime < sunday.endTime).toBe(true);
    }
    const payloads = planOnboardingWorkingHours({
      staffId: result.membership.userId,
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      hours: draft.hours,
    });
    expect(payloads.filter((item) => !item.isWorking)).toHaveLength(2);
  });
});

describe("K–M refuse invalid create", () => {
  it("K does not save when working hours start >= end", () => {
    const before = listMemberships(ORG_ENJOYE_ID).length;
    const hours = defaultOnboardingHours().map((item) =>
      item.dayOfWeek === 1
        ? { ...item, isWorking: true, startTime: "18:00", endTime: "09:00" }
        : item,
    );
    expect(validateOnboardingStep3(basicDraft({ scheduleMode: "basic", hours }))).toBe(
      "上班結束時間必須晚於開始時間",
    );
    expect(() =>
      createStaffOnboardingFromDraft(
        ORG_ENJOYE_ID,
        basicDraft({ scheduleMode: "basic", hours }),
      ),
    ).toThrow(/結束時間/);
    expect(listMemberships(ORG_ENJOYE_ID)).toHaveLength(before);
  });

  it("L does not save without a location", () => {
    const before = listMemberships(ORG_ENJOYE_ID).length;
    const draft = basicDraft({ locationIds: [] });
    expect(validateOnboardingStep2(draft, listLocations(ORG_ENJOYE_ID))).toBe(
      "請至少選擇一間分店",
    );
    expect(() => createStaffOnboardingFromDraft(ORG_ENJOYE_ID, draft)).toThrow(/分店/);
    expect(listMemberships(ORG_ENJOYE_ID)).toHaveLength(before);
  });

  it("M does not save a blank displayName", () => {
    const before = listMemberships(ORG_ENJOYE_ID).length;
    expect(() =>
      createStaffOnboardingFromDraft(ORG_ENJOYE_ID, basicDraft({ displayName: "   " })),
    ).toThrow(/姓名/);
    expect(listMemberships(ORG_ENJOYE_ID)).toHaveLength(before);
  });
});

describe("N–P read models", () => {
  it("N new staff appears in listMemberships", () => {
    const created = createStaffOnboardingFromDraft(ORG_ENJOYE_ID, basicDraft()).membership;
    expect(listMemberships(ORG_ENJOYE_ID).some((item) => item.userId === created.userId)).toBe(
      true,
    );
  });

  it("O new staff appears in Staff Workspace derived list", () => {
    const created = createStaffOnboardingFromDraft(
      ORG_ENJOYE_ID,
      basicDraft({ displayName: "工作區新人" }),
    ).membership;
    const built = workspaceFor(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, "THE ENJOYE 主店");
    const row = built.rows.find((item) => item.staffId === created.userId);
    expect(row?.displayName).toBe("工作區新人");
    expect(row?.membershipId).toBe(created.id);
    expect(row?.isActive).toBe(true);
    expect(row?.locationIds).toEqual([LOC_ENJOYE_PRIMARY_ID]);
  });

  it("P Calendar listBookableStaff includes the new active membership", () => {
    const created = createStaffOnboardingFromDraft(ORG_ENJOYE_ID, basicDraft()).membership;
    const bookable = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    expect(bookable.some((item) => item.userId === created.userId)).toBe(true);
    expect(bookable.every((item) => item.isActive)).toBe(true);
  });
});

describe("Q deactivate contract", () => {
  it("keeps history-capable membership while dropping bookable staff", () => {
    const created = createStaffOnboardingFromDraft(
      ORG_ENJOYE_ID,
      basicDraft({ displayName: "即將停用" }),
    ).membership;
    const updated = updateMembership(ORG_ENJOYE_ID, created.id, { isActive: false });
    expect(updated.isActive).toBe(false);
    expect(listMemberships(ORG_ENJOYE_ID).find((item) => item.id === created.id)?.displayName).toBe(
      "即將停用",
    );
    expect(
      listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID).some(
        (item) => item.userId === created.userId,
      ),
    ).toBe(false);
    const built = workspaceFor(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, "THE ENJOYE 主店");
    expect(built.rows.find((item) => item.staffId === created.userId)?.todayStatus).toBe(
      "inactive",
    );
  });
});

describe("R–S isolation", () => {
  it("R org A cannot see org B memberships", () => {
    const enjoye = createStaffOnboardingFromDraft(
      ORG_ENJOYE_ID,
      basicDraft({ displayName: "A店新人" }),
    ).membership;
    const lumiere = createMembership({
      organizationId: ORG_LUMIERE_ID,
      displayName: "B店新人",
      role: "STAFF",
      locationIds: [LOC_LUMIERE_PRIMARY_ID],
    });
    expect(listMemberships(ORG_ENJOYE_ID).some((item) => item.id === lumiere.id)).toBe(false);
    expect(listMemberships(ORG_LUMIERE_ID).some((item) => item.id === enjoye.id)).toBe(false);
    expect(
      listBookableStaff(ORG_LUMIERE_ID, LOC_LUMIERE_PRIMARY_ID).some(
        (item) => item.userId === enjoye.userId,
      ),
    ).toBe(false);
  });

  it("S location A hours do not appear on location B", () => {
    const result = createStaffOnboardingFromDraft(
      ORG_ENJOYE_ID,
      basicDraft({
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
        scheduleMode: "basic",
        hours: applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-sat"),
      }),
    );
    const primary = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: result.membership.userId,
    });
    const secondary = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_SECONDARY_ID,
    }).filter((item) => item.staffId === result.membership.userId);
    expect(primary.length).toBeGreaterThan(0);
    expect(secondary).toHaveLength(0);
  });
});

describe("T source contract + fail-safe", () => {
  it("does not invent a second staff / employee / schedule store", () => {
    expect(STAFF_HAS_EMPLOYEE_DOMAIN).toBe(false);
    expect(STAFF_HAS_SECOND_MEMBERSHIP_STORE).toBe(false);
    expect(STAFF_HAS_AUTH_ACCOUNT_CREATE).toBe(false);
    expect(STAFF_HAS_SECOND_SCHEDULE_STORE).toBe(false);
    expect(STAFF_HAS_SECOND_AVAILABILITY_CALCULATOR).toBe(false);

    const root = process.cwd();
    const onboarding = readFileSync(path.join(root, "lib/staff/staff-onboarding.ts"), "utf8");
    const derived = readFileSync(
      path.join(root, "lib/staff/staff-onboarding-derived.ts"),
      "utf8",
    );
    const dialog = readFileSync(
      path.join(root, "features/staff/StaffOnboardingDialog.tsx"),
      "utf8",
    );
    const store = readFileSync(path.join(root, "lib/tenant/organization-store.ts"), "utf8");
    const page = readFileSync(path.join(root, "features/staff/StaffWorkspacePage.tsx"), "utf8");

    expect(onboarding).toMatch(/createMembership/);
    expect(onboarding).toMatch(/upsertWorkingHours/);
    expect(onboarding).not.toMatch(/localStorage\.setItem/);
    expect(derived).not.toMatch(/localStorage/);
    expect(derived).not.toMatch(/SEED_MEMBERSHIPS/);
    expect(dialog).not.toMatch(/localStorage\.setItem/);
    expect(dialog).toMatch(/createStaffOnboardingFromDraft|createStaffOnboarding/);
    expect(dialog).toMatch(/role="dialog"/);
    expect(dialog).toMatch(/aria-modal="true"/);
    expect(dialog).toMatch(/aria-labelledby/);
    expect(dialog).toMatch(/mb-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(store).toMatch(/newId\("mem"\)/);
    expect(store).toMatch(/newId\("staff"\)/);
    expect(store).toMatch(/MEMBERSHIP_OVERRIDES_STORAGE_KEY/);
    expect(page).not.toMatch(/employees\s*=\s*\[/);
    expect(page).not.toMatch(/createStaffStore|employeeStore|membershipStoreV2/);
  });

  it("refuses foreign locations and keeps the override key as StaffMembership map", () => {
    const before = listMemberships(ORG_ENJOYE_ID).length;
    expect(() =>
      createStaffOnboardingFromDraft(
        ORG_ENJOYE_ID,
        basicDraft({ locationIds: [LOC_LUMIERE_PRIMARY_ID] }),
      ),
    ).toThrow(/分店/);
    expect(listMemberships(ORG_ENJOYE_ID)).toHaveLength(before);
    createStaffOnboardingFromDraft(ORG_ENJOYE_ID, basicDraft({ displayName: "覆寫檢查" }));
    const raw = JSON.parse(localStorage.getItem(MEMBERSHIP_OVERRIDES_STORAGE_KEY) ?? "{}") as Record<
      string,
      { organizationId: string; userId: string; displayName: string }
    >;
    expect(Object.values(raw).every((item) => item.userId && item.organizationId)).toBe(true);
  });

  it("keeps membership and reports when schedule write fails after create", () => {
    vi.spyOn(staffSchedule, "upsertWorkingHours").mockImplementation(() => {
      throw new Error("hours write failed");
    });
    const result = createStaffOnboardingFromDraft(
      ORG_ENJOYE_ID,
      basicDraft({
        displayName: "半套班表",
        scheduleMode: "basic",
        hours: applyOnboardingHoursPattern(defaultOnboardingHours(), "mon-fri"),
      }),
    );
    expect(result.scheduleError).toBe("hours write failed");
    expect(listMemberships(ORG_ENJOYE_ID).some((item) => item.id === result.membership.id)).toBe(
      true,
    );
  });

  it("RBAC uses existing staff nav roles and later-mode skips hours writes", () => {
    expect(canManageStaff("OWNER")).toBe(true);
    expect(canManageStaff("MANAGER")).toBe(true);
    expect(canManageStaff("STAFF")).toBe(false);
    expect(canManageStaff("RECEPTIONIST")).toBe(false);
    expect(canManageStaff("ACCOUNTANT")).toBe(false);
    const spy = vi.spyOn(staffSchedule, "upsertWorkingHours");
    const result = createStaffOnboarding(
      {
        organizationId: ORG_ENJOYE_ID,
        displayName: "稍後班表",
        role: "MANAGER",
        locationIds: [LOC_ENJOYE_PRIMARY_ID],
      },
      basicDraft({ displayName: "稍後班表", role: "MANAGER", scheduleMode: "later" }),
    );
    expect(result.scheduleError).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("empty draft validation matches the create gate", () => {
    const locations = listLocations(ORG_ENJOYE_ID);
    expect(validateOnboardingDraft(emptyOnboardingDraft(), locations)).toBe("請填寫員工姓名");
    expect(
      validateOnboardingDraft(basicDraft({ locationIds: [] }), locations),
    ).toBe("請至少選擇一間分店");
  });
});
