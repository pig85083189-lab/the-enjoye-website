import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TREATMENT_REMOTE_READ_PILOT_ENV } from "@/lib/treatments/treatment-remote-read-flag";
import {
  TREATMENT_REMOTE_WRITE_PILOT_ENV,
  isTreatmentRemoteWritePilotEnabled,
} from "@/lib/treatments/treatment-remote-write-flag";
import { treatmentWorkspaceEntryHref } from "@/lib/treatments/treatment-identity";
import { shouldShowTodayPrimaryAction } from "@/lib/today/today-actions";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "@/lib/commerce/commerce-remote-write-flag";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Production Treatment WRITE canary", () => {
  it("WRITE requires explicit READ and stays independent of Commerce / Appointment MUTATE", () => {
    expect(TREATMENT_REMOTE_WRITE_PILOT_ENV).toBe(
      "BEAUTY_OS_TREATMENT_REMOTE_WRITE_PILOT",
    );
    expect(
      isTreatmentRemoteWritePilotEnabled({
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isTreatmentRemoteWritePilotEnabled({
        [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isTreatmentRemoteWritePilotEnabled({
        [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(COMMERCE_REMOTE_WRITE_PILOT_ENV).toBe(
      "BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT",
    );
    expect(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV).toBe(
      "BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT",
    );
  });

  it("Today, Customer 360, and Calendar share the canonical Treatment create href", () => {
    expect(
      treatmentWorkspaceEntryHref({
        customerId: "cust-muvb8x0p-887ltc",
        appointmentId: "apt-muw55olz-h64n65",
      }),
    ).toBe(
      "/staff/treatments/new?customer=cust-muvb8x0p-887ltc&appointment=apt-muw55olz-h64n65",
    );
    const today = read("lib/today/today-actions.ts");
    const snapshot = read("features/customers/use-customer-360.ts");
    const identity = read("lib/treatments/treatment-identity.ts");
    const calendar = read("features/calendar/AppointmentQuickView.tsx");
    expect(today).toMatch(
      /\/staff\/treatments\/new\?customer=\$\{appointment\.customerId\}&appointment=\$\{appointment\.id\}/,
    );
    expect(identity).toMatch(
      /\/staff\/treatments\/new\?customer=\$\{input\.customerId\}&appointment=\$\{input\.appointmentId\}/,
    );
    expect(snapshot).toMatch(/treatmentWorkspaceEntryHref/);
    expect(calendar).toMatch(/resolveTodayPrimaryAction/);
    expect(calendar).toMatch(/primary\.href/);
    expect(today).not.toMatch(/\/staff\/treatments\/new\?name=/);
    expect(calendar).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("keeps start-treatment visible on Today and Calendar while Appointment MUTATE is off", () => {
    expect(shouldShowTodayPrimaryAction("start_treatment", true)).toBe(true);
    const card = read("components/appointments/AppointmentCard.tsx");
    const panel = read("components/appointments/NextCustomerPanel.tsx");
    const quick = read("features/calendar/AppointmentQuickView.tsx");
    expect(card).toMatch(/shouldShowTodayPrimaryAction/);
    expect(panel).toMatch(/shouldShowTodayPrimaryAction/);
    expect(quick).toMatch(/primary\.kind === "start_treatment"/);
    expect(quick).toMatch(/actions\.canTransition &&/);
    expect(quick).not.toMatch(
      /actions\.canTransition && primary\.kind !== "none" \? \(/,
    );
  });

  it("hands Treatment WRITE at request time and does not open other writes", () => {
    const page = read("app/staff/(app)/treatments/new/page.tsx");
    expect(page).toMatch(/await connection\(\)/);
    expect(page).toMatch(/isTreatmentRemoteWritePilotEnabled/);
    expect(page).toMatch(/treatment-remote-write-flag/);
    expect(page).not.toMatch(/treatment-remote-write-pilot/);
    expect(page).not.toMatch(/isAppointmentRemoteMutatePilotEnabled/);
    expect(page).not.toMatch(/isCommerceRemoteWritePilotEnabled/);
    const workspace = read("features/treatments/TreatmentWorkspace.tsx");
    expect(workspace).toMatch(/treatmentRemoteWritePilot/);
    expect(workspace).toMatch(/if \(treatmentRemoteReadPilot\) return;/);
    expect(workspace).not.toMatch(/runAuthenticatedAppointmentUpdate|updateAppointment\(/);
  });

  it("uses one Appointment → one Treatment, OCC autosave, and completed immutability", () => {
    const adapter = read("lib/persistence/treatment-remote-adapter.ts");
    const store = read("lib/persistence/authenticated-treatment-store.ts");
    const hook = read("hooks/useTreatmentDraft.ts");
    const migration = read(
      "supabase/migrations/20261004120000_treatment_remote_foundation.sql",
    );
    expect(adapter).toMatch(/TreatmentDuplicateError/);
    expect(adapter).toMatch(/getTreatmentByAppointmentId/);
    expect(adapter).toMatch(/TreatmentCompletedImmutableError/);
    expect(adapter).toMatch(/requireOperationalStaffId/);
    expect(adapter).toMatch(/isAuthUuid/);
    expect(adapter).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(store).toMatch(/eq\("updated_at", input\.expectedUpdatedAt\)/);
    expect(hook).toMatch(/submitTreatmentRemoteCreate/);
    expect(hook).toMatch(/submitTreatmentRemoteAutosave/);
    expect(hook).toMatch(/if \(remoteRead && !remoteWrite\) \{\s*return;/);
    expect(hook).toMatch(/expectedUpdatedAt/);
    expect(hook).toMatch(/TreatmentDuplicateError/);
    expect(migration).toMatch(/idx_treatments_org_appointment/);
    expect(migration).toMatch(/trg_treatments_completed_immutable/);
    expect(migration).toMatch(/user_has_org_membership/);
  });
});
