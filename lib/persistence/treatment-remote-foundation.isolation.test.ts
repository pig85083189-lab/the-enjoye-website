import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TREATMENT_REMOTE_FOUNDATION_MIGRATION_FILE } from "./schema-contract";
import { getPersistenceDriver } from "./driver";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";
import { isTreatmentRemoteWritePilotEnabled } from "@/lib/treatments/treatment-remote-write-flag";

const SQL = readFileSync(
  path.join(process.cwd(), TREATMENT_REMOTE_FOUNDATION_MIGRATION_FILE),
  "utf8",
);

describe("Phase 1C-6G Treatment remote foundation SQL", () => {
  it("reuses public.treatments and does not create a parallel table", () => {
    expect(SQL).toMatch(/alter table public\.treatments/);
    expect(SQL).not.toMatch(/create table if not exists public\.treatments\b/);
    expect(SQL).not.toMatch(/create table if not exists public\.remote_treatments/);
    expect(SQL).not.toMatch(/create table if not exists public\.treatment_records/);
  });

  it("adds attribution, clinical extras, same-org FKs, and location NOT NULL", () => {
    expect(SQL).toMatch(/add column if not exists created_by text/);
    expect(SQL).toMatch(/add column if not exists updated_by text/);
    expect(SQL).toMatch(/add column if not exists photo_meta jsonb/);
    expect(SQL).toMatch(/treatments_created_by_operational/);
    expect(SQL).toMatch(/is_operational_staff_id\(created_by\)/);
    expect(SQL).toMatch(/alter column location_id set not null/);
    expect(SQL).toContain("treatments_customer_same_org_fkey");
    expect(SQL).toContain("treatments_service_same_org_fkey");
    expect(SQL).toContain("treatments_location_same_org_fkey");
    expect(SQL).toContain("treatments_appointment_same_org_fkey");
    expect(SQL).toMatch(/idx_treatments_org_appointment/);
  });

  it("uses location-aware RLS and existing membership helpers", () => {
    expect(SQL).toMatch(/user_has_org_membership\(treatments\.organization_id\)/);
    expect(SQL).toMatch(
      /user_can_access_location\(\s*treatments\.organization_id,\s*treatments\.location_id/,
    );
    expect(SQL).not.toMatch(/create or replace function public\.user_can_access_location/);
    expect(SQL).toMatch(/enforce_treatment_staff_integrity/);
    expect(SQL).toMatch(/completed treatment cannot return to DRAFT/);
  });

  it("does not invent Storage or write business rows", () => {
    expect(SQL).not.toMatch(/storage\.objects|create bucket|insert into public\.treatments/i);
    expect(SQL).not.toMatch(/\binsert into public\.(customers|appointments|locations)\b/i);
    expect(SQL).toMatch(/Metadata only/);
  });

  it("does not enable global persistence or live pilots", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(isTreatmentRemoteReadPilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({})).toBe(false);
  });
});

describe("Phase 1C-6G Treatment foundation source contracts", () => {
  it("write factory never uses service role or dual local write", () => {
    const factory = readFileSync(
      path.join(process.cwd(), "lib/treatments/treatment-remote-write-pilot.ts"),
      "utf8",
    );
    const store = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-treatment-store.ts"),
      "utf8",
    );
    const adapter = readFileSync(
      path.join(process.cwd(), "lib/persistence/treatment-remote-adapter.ts"),
      "utf8",
    );
    expect(factory).toMatch(/Does not enable BEAUTY_OS_PERSISTENCE/);
    expect(factory).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(factory).not.toMatch(/saveDraft\(|saveCompletedTreatment\(/);
    expect(store).not.toMatch(/\.upsert\(/);
    expect(store).toMatch(/insert-only/);
    expect(adapter).toMatch(/expectedUpdatedAt/);
    expect(adapter).toMatch(/Photos are metadata-only/);
    expect(adapter).not.toMatch(/treatment_photos/);
  });
});
