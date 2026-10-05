import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPersistenceDriver } from "@/lib/persistence/driver";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV } from "./appointment-remote-write-flag";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "./calendar-remote-read-flag";
import {
  APPOINTMENT_REMOTE_MUTATE_PILOT_ENV,
  isAppointmentRemoteMutatePilotEnabled,
} from "./appointment-remote-mutate-flag";

const MUTATE_ON = {
  [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
  [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
  [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
};

describe("Phase 1C-6D.1 appointment remote mutate flag", () => {
  it("stays off unless mutate + write + calendar-read are all on", () => {
    expect(isAppointmentRemoteMutatePilotEnabled({})).toBe(false);
    expect(isAppointmentRemoteMutatePilotEnabled(MUTATE_ON)).toBe(true);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("honors explicit Production env and ignores global persistence", () => {
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        ...MUTATE_ON,
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        ...MUTATE_ON,
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        ...MUTATE_ON,
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe(true);
    expect(getPersistenceDriver(MUTATE_ON)).toBe("local");
    expect(
      getPersistenceDriver({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
      }),
    ).toBe("local");
  });

  it("is RSC-safe and does not add a Vercel env in this slice", () => {
    const flag = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-remote-mutate-flag.ts"),
      "utf8",
    );
    expect(flag).not.toMatch(
      /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|loadAuthenticatedIdentityCatalog|createServiceRoleClient/,
    );
    const envExample = [
      ".env",
      ".env.local",
      ".env.example",
      "vercel.json",
    ].flatMap((file) => {
      try {
        return [readFileSync(path.join(process.cwd(), file), "utf8")];
      } catch {
        return [];
      }
    });
    for (const source of envExample) {
      expect(source).not.toMatch(/BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT/);
    }
  });
});
