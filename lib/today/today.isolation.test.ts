import { describe, expect, it } from "vitest";
import {
  appointmentStartDate,
  collectAttentionNotes,
  resolveBriefingTiming,
} from "@/lib/today/briefing";
import {
  resolveTodayPrimaryAction,
  shouldShowTodayPrimaryAction,
} from "@/lib/today/today-actions";
import type { Appointment, Customer } from "@/types";

const baseAppointment: Appointment = {
  id: "apt-1",
  organizationId: "org-enjoye",
  locationId: "loc-1",
  customerId: "cust-1",
  customerName: "王小美",
  serviceId: "svc-breast",
  serviceName: "性感美胸 SPA",
  durationMinutes: 100,
  time: "10:00",
  status: "pending",
  membership: "vip",
  notes: ["右側腋下較緊"],
  staffId: "staff-1",
  staffName: "怡蓁",
};

const baseCustomer: Customer = {
  id: "cust-1",
  organizationId: "org-enjoye",
  name: "王小美",
  phone: "0912",
  birthday: "1990-01-01",
  age: 36,
  membership: "vip",
  lastVisit: "2026/09/10",
  totalVisits: 6,
  packages: [],
  lastServiceNotes: [],
  trackingFocus: ["外擴追蹤"],
  alerts: [{ id: "a1", customerId: "cust-1", label: "敏感", value: "皮膚敏感" }],
  tags: [],
  joinedAt: "2024-01-01",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  importantNotes: ["經期前容易脹痛"],
};

describe("resolveBriefingTiming", () => {
  it("returns minutes until start when pending and later", () => {
    const now = new Date(2026, 8, 27, 9, 43, 0);
    const result = resolveBriefingTiming(
      { ...baseAppointment, status: "pending", time: "10:00" },
      now,
    );
    expect(result.kind).toBe("later");
    if (result.kind === "later") {
      expect(result.minutes).toBe(17);
      expect(result.label).toBe("17 分鐘後");
    }
  });

  it("returns waiting when past start and still pending", () => {
    const now = new Date(2026, 8, 27, 10, 5, 0);
    const result = resolveBriefingTiming(
      { ...baseAppointment, status: "pending", time: "10:00" },
      now,
    );
    expect(result).toEqual({ kind: "waiting", label: "等待開始" });
  });

  it("returns in_service elapsed minutes", () => {
    const now = new Date(2026, 8, 27, 10, 32, 0);
    const result = resolveBriefingTiming(
      { ...baseAppointment, status: "in_progress", time: "10:00" },
      now,
    );
    expect(result.kind).toBe("in_service");
    if (result.kind === "in_service") {
      expect(result.elapsedMinutes).toBe(32);
      expect(result.label).toBe("服務進行中 · 32 分鐘");
    }
  });
});

describe("appointmentStartDate", () => {
  it("combines local date with HH:mm", () => {
    const now = new Date(2026, 8, 27, 15, 0, 0);
    const start = appointmentStartDate("10:00", now);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(27);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(0);
  });
});

describe("collectAttentionNotes", () => {
  it("merges appointment notes and customer fields without inventing data", () => {
    const notes = collectAttentionNotes(
      "org-enjoye",
      baseCustomer,
      baseAppointment,
    );
    expect(notes).toContain("右側腋下較緊");
    expect(notes).toContain("皮膚敏感");
    expect(notes).toContain("經期前容易脹痛");
    expect(notes).toContain("外擴追蹤");
  });

  it("returns empty when no notes exist", () => {
    const notes = collectAttentionNotes("org-enjoye", undefined, {
      ...baseAppointment,
      notes: [],
    });
    expect(notes).toEqual([]);
  });
});

describe("resolveTodayPrimaryAction", () => {
  it("maps pending to start treatment", () => {
    const action = resolveTodayPrimaryAction(
      { ...baseAppointment, status: "pending" },
      "BOOKED",
    );
    expect(action.kind).toBe("start_treatment");
    if (action.kind !== "none") {
      expect(action.label).toBe("開始服務");
      expect(action.href).toContain("/staff/treatments/new");
    }
  });

  it("keeps start treatment visible when Today is appointment-read-only", () => {
    expect(shouldShowTodayPrimaryAction("start_treatment", true)).toBe(true);
    expect(shouldShowTodayPrimaryAction("continue_treatment", true)).toBe(true);
    expect(shouldShowTodayPrimaryAction("view_record", true)).toBe(true);
    expect(shouldShowTodayPrimaryAction("checkout", true)).toBe(true);
    expect(shouldShowTodayPrimaryAction("none", true)).toBe(false);
  });

  it("maps in_progress to continue treatment", () => {
    const action = resolveTodayPrimaryAction(
      { ...baseAppointment, status: "in_progress" },
      "IN_SERVICE",
    );
    expect(action.kind).toBe("continue_treatment");
    if (action.kind !== "none") {
      expect(action.label).toBe("繼續療程");
    }
  });
});
