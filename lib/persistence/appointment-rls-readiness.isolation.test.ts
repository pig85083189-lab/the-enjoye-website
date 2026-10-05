import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPersistenceDriver } from "./driver";
import { isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-pilot";
import {
  APPOINTMENT_INTEGRITY_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_FILE,
  STRATEGY_B_RLS_MIGRATION_FILE,
} from "./schema-contract";

const OPERATIONAL = path.join(process.cwd(), OPERATIONAL_MIGRATION_FILE);
const INTEGRITY = path.join(process.cwd(), APPOINTMENT_INTEGRITY_MIGRATION_FILE);
const STRATEGY_B = path.join(process.cwd(), STRATEGY_B_RLS_MIGRATION_FILE);

describe("Phase 1C-5A appointment RLS readiness", () => {
  const sql = `${readFileSync(INTEGRITY, "utf8")}\n${readFileSync(STRATEGY_B, "utf8")}`;
  const operational = readFileSync(OPERATIONAL, "utf8");

  it("INSERT requires org membership and location helper", () => {
    expect(sql).toMatch(
      /create policy appointments_insert_org[\s\S]*user_has_org_membership\(appointments\.organization_id\)/,
    );
    expect(sql).toMatch(
      /create policy appointments_insert_org[\s\S]*user_can_access_location\(appointments\.organization_id, appointments\.location_id\)/,
    );
  });

  it("foundation INSERT did not check customer or service organization", () => {
    const insertBlock = sql.slice(
      sql.indexOf("create policy appointments_insert_org"),
      sql.indexOf("create policy appointments_update_org"),
    );
    expect(insertBlock).not.toMatch(/customers\.organization_id/);
    expect(insertBlock).not.toMatch(/services\.organization_id/);
    expect(insertBlock).not.toMatch(/customer_id in \(select/i);
    expect(insertBlock).not.toMatch(/service_id in \(select/i);
  });

  it("location helper still allows null location_id globally", () => {
    expect(operational).toMatch(/target_loc is null/);
  });

  it("staff columns are operational text, never Auth UUID FK", () => {
    expect(operational).toMatch(/appointments_staff_id_operational/);
    expect(operational).toMatch(/is_operational_staff_id\(staff_id\)/);
    expect(operational).toMatch(/alter column staff_id type text/);
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

describe("Phase 1C-5A.1 appointment tenant integrity SQL", () => {
  const integrity = readFileSync(INTEGRITY, "utf8");
  const operational = readFileSync(OPERATIONAL, "utf8");

  it("does not rewrite user_can_access_location", () => {
    expect(integrity).not.toMatch(/create or replace function public\.user_can_access_location/);
    expect(operational).toMatch(/target_loc is null/);
  });

  it("makes appointments.location_id NOT NULL without touching other tables", () => {
    expect(integrity).toMatch(
      /alter table public\.appointments\s+alter column location_id set not null/,
    );
    expect(integrity).not.toMatch(
      /alter table public\.treatments\s+alter column location_id set not null/,
    );
    expect(integrity).not.toMatch(
      /alter table public\.customers\s+alter column \w+ set not null/,
    );
    expect(integrity).not.toMatch(
      /alter table public\.services\s+alter column \w+ set not null/,
    );
  });

  it("enforces same-org customer / service / location via composite FKs", () => {
    expect(integrity).toContain("appointments_customer_same_org_fkey");
    expect(integrity).toContain("appointments_service_same_org_fkey");
    expect(integrity).toContain("appointments_location_same_org_fkey");
    expect(integrity).toMatch(
      /foreign key \(customer_id, organization_id\)\s+references public\.customers \(id, organization_id\)/,
    );
    expect(integrity).toMatch(
      /foreign key \(service_id, organization_id\)\s+references public\.services \(id, organization_id\)/,
    );
    expect(integrity).toMatch(
      /foreign key \(location_id, organization_id\)\s+references public\.locations \(id, organization_id\)/,
    );
  });

  it("keeps INSERT and UPDATE authorization plus location_id IS NOT NULL", () => {
    const insertBlock = integrity.slice(
      integrity.lastIndexOf("create policy appointments_insert_org"),
      integrity.lastIndexOf("create policy appointments_update_org"),
    );
    expect(insertBlock).toMatch(/appointments\.location_id is not null/);
    expect(insertBlock).toMatch(/user_has_org_membership\(appointments\.organization_id\)/);
    expect(insertBlock).toMatch(
      /user_can_access_location\(\s*appointments\.organization_id,\s*appointments\.location_id/,
    );

    const updateBlock = integrity.slice(
      integrity.lastIndexOf("create policy appointments_update_org"),
    );
    expect(updateBlock).toMatch(/using \(/);
    expect(updateBlock).toMatch(/with check \(/);
    expect(updateBlock).toMatch(/appointments\.location_id is not null/);
    expect(updateBlock).toMatch(
      /user_can_access_location\(\s*appointments\.organization_id,\s*appointments\.location_id/,
    );
  });

  it("adds the narrowest staff catalog check and documents the leftover hole", () => {
    expect(integrity).toContain("operational_staff_belongs_to_organization");
    expect(integrity).toContain("operational_staff_can_access_location");
    expect(integrity).toContain("trg_appointments_staff_integrity");
    expect(integrity).toMatch(/staff_auth_memberships/);
    expect(integrity).not.toMatch(/create table if not exists public\.staff_memberships/);
    expect(integrity).toMatch(/Login-less operational staff cannot be proven/);
  });

  it("contains no business row writes", () => {
    expect(integrity).not.toMatch(/\binsert into public\.(customers|services|appointments|locations)\b/i);
    expect(integrity).not.toMatch(/\bdelete from public\.(customers|services|appointments)\b/i);
    expect(integrity).not.toMatch(/\bupdate public\.(customers|services)\b/i);
  });
});
