import { readFileSync } from "node:fs";
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
    ).toBe(true);
    expect(
      isTreatmentRemoteWritePilotEnabled({ ...WRITE_ON, VERCEL_TARGET_ENV: "production" }),
    ).toBe(true);
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

  it("keeps RSC pages on flag files and live UI off service role / dual write", () => {
    for (const file of [
      "app/staff/(app)/treatments/new/page.tsx",
      "app/staff/(app)/treatments/page.tsx",
      "app/staff/(app)/treatments/[id]/page.tsx",
      "app/staff/(app)/today/page.tsx",
      "app/staff/(app)/customers/[id]/page.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toMatch(/isTreatmentRemoteReadPilotEnabled/);
      expect(source).not.toMatch(/treatment-remote-read-pilot|treatment-remote-write-pilot|AuthenticatedTreatmentTableStore|createServiceRoleClient/);
    }
    const writeHook = readFileSync(
      path.join(process.cwd(), "features/treatments/use-treatment-remote-write.ts"),
      "utf8",
    );
    expect(writeHook).toMatch(/runAuthenticatedTreatmentCreate|runAuthenticatedTreatmentAutosave|runAuthenticatedTreatmentComplete/);
    expect(writeHook).toMatch(/\[TREATMENT_REMOTE_WRITE_PILOT_ENV\]:\s*"1"/);
    expect(writeHook).toMatch(/\[TREATMENT_REMOTE_READ_PILOT_ENV\]:\s*"1"/);
    expect(writeHook).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(writeHook).not.toMatch(/saveDraft\(|saveCompletedTreatment\(/);
    const draft = readFileSync(path.join(process.cwd(), "hooks/useTreatmentDraft.ts"), "utf8");
    expect(draft).toMatch(/remoteWrite/);
    expect(draft).toMatch(/submitTreatmentRemoteAutosave/);
    expect(draft).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    const localDraft = readFileSync(path.join(process.cwd(), "lib/treatment-draft.ts"), "utf8");
    expect(localDraft).not.toMatch(/treatment-remote-read-pilot|runAuthenticatedTreatmentCreate/);
  });
});
