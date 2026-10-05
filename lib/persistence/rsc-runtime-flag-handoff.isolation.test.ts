import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const RSC_FLAG_HANDOFF_PAGES = [
  "app/staff/(app)/customers/page.tsx",
  "app/staff/(app)/customers/[id]/page.tsx",
  "app/staff/(app)/customers/[id]/edit/page.tsx",
  "app/staff/(app)/customers/new/page.tsx",
  "app/staff/(app)/checkout/page.tsx",
  "app/staff/(app)/transactions/page.tsx",
  "app/staff/(app)/calendar/page.tsx",
  "app/staff/(app)/today/page.tsx",
  "app/staff/(app)/treatments/page.tsx",
  "app/staff/(app)/treatments/[id]/page.tsx",
  "app/staff/(app)/treatments/new/page.tsx",
  "app/staff/(app)/staff/page.tsx",
] as const;

describe("Phase 1C-6H.2P RSC runtime flag handoff", () => {
  it("awaits connection() before evaluating flags on every staff handoff page", () => {
    for (const file of RSC_FLAG_HANDOFF_PAGES) {
      const source = read(file);
      expect(source, file).toMatch(/from "next\/server"/);
      expect(source, file).toMatch(/await connection\(\)/);
      expect(source, file).toMatch(/export default async function/);
      expect(source, file).not.toMatch(/force-dynamic/);
      expect(source, file).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
      expect(source, file).not.toMatch(
        /customer-remote-read-pilot|appointment-remote-read-pilot|calendar-remote-read-pilot|today-remote-read-pilot|treatment-remote-read-pilot|commerce-remote-read-pilot|commerce-remote-write-pilot|staff-remote-create-pilot/,
      );
    }
  });

  it("keeps Checkout / Transactions / Calendar / Today / Treatments / Staff on *-flag helpers", () => {
    expect(read("app/staff/(app)/checkout/page.tsx")).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/checkout/page.tsx")).toMatch(/isCommerceRemoteWritePilotEnabled/);
    expect(read("app/staff/(app)/transactions/page.tsx")).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/calendar/page.tsx")).toMatch(/isCalendarRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/today/page.tsx")).toMatch(/isTodayRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/treatments/page.tsx")).toMatch(/isTreatmentRemoteReadPilotEnabled/);
    expect(read("app/staff/(app)/treatments/new/page.tsx")).toMatch(/isTreatmentRemoteWritePilotEnabled/);
    expect(read("app/staff/(app)/staff/page.tsx")).toMatch(/isStaffRemoteCreatePilotEnabled/);
  });
});
