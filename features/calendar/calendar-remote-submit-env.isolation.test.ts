// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calendarRemoteSubmitEnv } from "@/features/calendar/calendar-remote-submit-env";
import { isAppointmentReminderPersistOpen } from "@/lib/line/automations/appointment-reminder-flag";
import {
  LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST,
  LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST,
} from "@/lib/line/line-flag";

const PREVIEW_URL = `https://${LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST}`;
const PRODUCTION_URL = `https://${LINE_BROADCAST_FORMAL_PRODUCTION_SUPABASE_HOST}`;

describe("calendarRemoteSubmitEnv", () => {
  it("opens Preview persist when the browser only has the Preview host", () => {
    const env = calendarRemoteSubmitEnv(
      { BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT: "1" },
      { NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL },
    );
    expect(env.VERCEL_ENV).toBe("preview");
    expect(env.BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN).toBe("1");
    expect(isAppointmentReminderPersistOpen({ env })).toBe(true);
  });

  it("stays closed on the Production Supabase host", () => {
    const env = calendarRemoteSubmitEnv({}, { NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL });
    expect(isAppointmentReminderPersistOpen({ env })).toBe(false);
    expect(env.BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN).toBeUndefined();
  });

  it("opens persist when the browser process.env spread is empty", () => {
    const env = calendarRemoteSubmitEnv(
      { NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL },
      {},
    );
    expect(isAppointmentReminderPersistOpen({ env })).toBe(true);
  });

  it("stays closed when VERCEL_ENV is production", () => {
    const env = calendarRemoteSubmitEnv(
      {},
      {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: PREVIEW_URL,
        BEAUTY_OS_LINE_APPOINTMENT_REMINDER_PERSIST_OPEN: "1",
      },
    );
    expect(env.VERCEL_ENV).toBe("production");
    expect(isAppointmentReminderPersistOpen({ env })).toBe(false);
  });
});
