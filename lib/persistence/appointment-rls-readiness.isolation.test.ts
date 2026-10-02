import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPersistenceDriver } from "./driver";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";

const OPERATIONAL = path.join(
  process.cwd(),
  "supabase/migrations/20260928113000_beauty_os_operational_foundation.sql",
);

describe("Phase 1C-5A appointment RLS readiness", () => {
  const sql = readFileSync(OPERATIONAL, "utf8");

  it("INSERT requires org membership and location helper", () => {
    expect(sql).toMatch(
      /create policy appointments_insert_org[\s\S]*user_has_org_membership\(appointments\.organization_id\)/,
    );
    expect(sql).toMatch(
      /create policy appointments_insert_org[\s\S]*user_can_access_location\(appointments\.organization_id, appointments\.location_id\)/,
    );
  });

  it("does not check customer or service organization on appointment INSERT", () => {
    const insertBlock = sql.slice(
      sql.indexOf("create policy appointments_insert_org"),
      sql.indexOf("create policy appointments_update_org"),
    );
    expect(insertBlock).not.toMatch(/customers\.organization_id/);
    expect(insertBlock).not.toMatch(/services\.organization_id/);
    expect(insertBlock).not.toMatch(/customer_id in \(select/i);
    expect(insertBlock).not.toMatch(/service_id in \(select/i);
  });

  it("location helper allows null location_id", () => {
    expect(sql).toMatch(/target_loc is null/);
  });

  it("staff columns are operational text, never Auth UUID FK", () => {
    expect(sql).toMatch(/appointments_staff_id_operational/);
    expect(sql).toMatch(/is_operational_staff_id\(staff_id\)/);
    expect(sql).toMatch(/alter column staff_id type text/);
  });

  it("does not enable global persistence or Customer pilot changes", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(
      isCustomerRemoteReadPilotEnabled({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(true);
    expect(getPersistenceDriver({ BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1" })).toBe("local");
  });
});
