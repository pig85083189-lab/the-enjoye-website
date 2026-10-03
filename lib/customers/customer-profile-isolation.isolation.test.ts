import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_READ_DIAGNOSTIC_ROUTE,
  CUSTOMER_PROFILE_ISOLATION_ROUTE,
  isAppointmentReadDiagnosticEnabled,
} from "@/lib/appointments/appointment-read-diagnostic-flag";

describe("Phase 1C-5C Customer Profile isolation diagnostic", () => {
  it("is Preview-only and keeps the first diagnostic route", () => {
    expect(CUSTOMER_PROFILE_ISOLATION_ROUTE).toBe("/staff/customer-profile-isolation");
    expect(APPOINTMENT_READ_DIAGNOSTIC_ROUTE).toBe("/staff/appointment-read-diagnostic");
    expect(
      existsSync(path.join(process.cwd(), "app/staff/(app)/appointment-read-diagnostic/page.tsx")),
    ).toBe(true);
    expect(
      existsSync(path.join(process.cwd(), "app/staff/(app)/customer-profile-isolation/page.tsx")),
    ).toBe(true);
    expect(
      isAppointmentReadDiagnosticEnabled({
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
  });

  it("does not write and does not import service-role", () => {
    const files = [
      "app/staff/(app)/customer-profile-isolation/page.tsx",
      "features/customers/CustomerProfileIsolationPage.tsx",
      "features/customers/isolation/stage-profile.tsx",
      "features/customers/isolation/stage-appointments.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("loads each isolation stage through dynamic import and Error Boundary", () => {
    const page = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfileIsolationPage.tsx"),
      "utf8",
    );
    expect(page).toMatch(/IsolationErrorBoundary/);
    expect(page).toMatch(/window.addEventListener\("error"/);
    expect(page).toMatch(/unhandledrejection/);
    expect(page).toMatch(/import\("\.\/isolation\/stage-a-shell"\)/);
    expect(page).toMatch(/import\("\.\/isolation\/stage-profile"\)/);
    expect(page).toMatch(/import\("\.\/isolation\/stage-appointments"\)/);
    expect(page).not.toMatch(/from ["']@\/features\/customers\/CustomerProfilePage["']/);
  });

  it("keeps Calendar / Today / formal profile off the isolation route", () => {
    for (const file of [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/customer-profile-isolation|CustomerProfileIsolationPage/);
    }
  });
});
