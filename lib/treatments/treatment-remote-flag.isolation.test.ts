import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import {
  TREATMENT_REMOTE_READ_PILOT_ENV,
  isTreatmentRemoteReadPilotEnabled,
} from "./treatment-remote-read-flag";
import {
  TREATMENT_REMOTE_WRITE_PILOT_ENV,
  isTreatmentRemoteWritePilotEnabled,
} from "./treatment-remote-write-flag";

const READ_ON = { [TREATMENT_REMOTE_READ_PILOT_ENV]: "1" };
const WRITE_ON = {
  [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
  [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
};

describe("Phase 1C-6G Treatment remote pilots", () => {
  it("stays off by default and in production", () => {
    expect(isTreatmentRemoteReadPilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteReadPilotEnabled(READ_ON)).toBe(true);
    expect(isTreatmentRemoteWritePilotEnabled(WRITE_ON)).toBe(true);
    expect(
      isTreatmentRemoteReadPilotEnabled({ ...READ_ON, VERCEL_ENV: "production" }),
    ).toBe(false);
    expect(
      isTreatmentRemoteWritePilotEnabled({ ...WRITE_ON, VERCEL_TARGET_ENV: "production" }),
    ).toBe(false);
  });

  it("write requires read and stays independent of global persistence", () => {
    expect(
      isTreatmentRemoteWritePilotEnabled({ [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1" }),
    ).toBe(false);
    expect(
      isTreatmentRemoteReadPilotEnabled({
        ...READ_ON,
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(true);
    expect(
      isTreatmentRemoteWritePilotEnabled({
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(false);
    expect(getPersistenceDriver(WRITE_ON)).toBe("local");
    expect(
      getPersistenceDriver({
        ...WRITE_ON,
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe("supabase");
  });

  it("does not couple Treatment pilots to Customer / Appointment / Staff flags", () => {
    expect(
      isTreatmentRemoteReadPilotEnabled({
        BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT: "1",
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
        BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT: "1",
        BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT: "1",
      }),
    ).toBe(false);
    const flag = readFileSync(
      path.join(process.cwd(), "lib/treatments/treatment-remote-read-flag.ts"),
      "utf8",
    );
    const writeFlag = readFileSync(
      path.join(process.cwd(), "lib/treatments/treatment-remote-write-flag.ts"),
      "utf8",
    );
    expect(flag).not.toMatch(/TreatmentRemoteAdapter|AuthenticatedTreatmentTableStore|createServiceRoleClient/);
    expect(writeFlag).not.toMatch(/TreatmentRemoteAdapter|AuthenticatedTreatmentTableStore|createServiceRoleClient/);
    expect(flag).toMatch(/Independent of BEAUTY_OS_PERSISTENCE/);
    expect(writeFlag).toMatch(/Independent of BEAUTY_OS_PERSISTENCE/);
  });

  it("keeps the adapter graph out of live Treatment UI", () => {
    for (const file of [
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/treatments/TreatmentWorkspace.tsx",
      "features/customers/tabs/TreatmentsTab.tsx",
      "hooks/useTreatmentDraft.ts",
      "lib/treatment-draft.ts",
    ]) {
      const full = path.join(process.cwd(), file);
      expect(existsSync(full), file).toBe(true);
      const source = readFileSync(full, "utf8");
      expect(source).not.toMatch(/BEAUTY_OS_TREATMENT_REMOTE_READ_PILOT|BEAUTY_OS_TREATMENT_REMOTE_WRITE_PILOT/);
      expect(source).not.toMatch(
        /treatment-remote-read-pilot|treatment-remote-write-pilot|runAuthenticatedTreatmentCreate|AuthenticatedTreatmentTableStore/,
      );
    }
  });
});
