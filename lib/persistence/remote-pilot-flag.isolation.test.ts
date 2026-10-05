import { describe, expect, it } from "vitest";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV, isAppointmentRemoteMutatePilotEnabled } from "@/lib/appointments/appointment-remote-mutate-flag";
import { APPOINTMENT_REMOTE_READ_PILOT_ENV, isAppointmentRemoteReadPilotEnabled } from "@/lib/appointments/appointment-remote-read-flag";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV, isAppointmentRemoteWritePilotEnabled } from "@/lib/appointments/appointment-remote-write-flag";
import { CALENDAR_REMOTE_READ_PILOT_ENV, isCalendarRemoteReadPilotEnabled } from "@/lib/appointments/calendar-remote-read-flag";
import { TODAY_REMOTE_READ_PILOT_ENV, isTodayRemoteReadPilotEnabled } from "@/lib/appointments/today-remote-read-flag";
import { COMMERCE_REMOTE_READ_PILOT_ENV, isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV, isCommerceRemoteWritePilotEnabled } from "@/lib/commerce/commerce-remote-write-flag";
import { CUSTOMER_REMOTE_READ_PILOT_ENV, isCustomerRemoteReadPilotEnabled } from "@/lib/customers/customer-remote-read-flag";
import { CUSTOMER_REMOTE_WRITE_PILOT_ENV, isCustomerRemoteWritePilotEnabled } from "@/lib/customers/customer-remote-write-flag";
import { TREATMENT_REMOTE_READ_PILOT_ENV, isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";
import { TREATMENT_REMOTE_WRITE_PILOT_ENV, isTreatmentRemoteWritePilotEnabled } from "@/lib/treatments/treatment-remote-write-flag";
import { isExplicitRemotePilotEnabled } from "./remote-pilot-flag";

const PREVIEW_VERIFIED = {
  [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
  [APPOINTMENT_REMOTE_READ_PILOT_ENV]: "1",
  [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
  [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
  [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
} as const;

describe("Phase 1C-6H.2P explicit remote-pilot enablement", () => {
  it("fails closed when the env is absent in every Vercel target", () => {
    for (const target of [{}, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      expect(isExplicitRemotePilotEnabled("BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT", target)).toBe(false);
      expect(isCustomerRemoteReadPilotEnabled(target)).toBe(false);
      expect(isAppointmentRemoteReadPilotEnabled(target)).toBe(false);
      expect(isCalendarRemoteReadPilotEnabled(target)).toBe(false);
      expect(isTodayRemoteReadPilotEnabled(target)).toBe(false);
      expect(isTreatmentRemoteReadPilotEnabled(target)).toBe(false);
      expect(isCommerceRemoteReadPilotEnabled(target)).toBe(false);
      expect(isCommerceRemoteWritePilotEnabled(target)).toBe(false);
    }
  });

  it("enables Production READ only when the env is explicitly 1", () => {
    expect(
      isCustomerRemoteReadPilotEnabled({
        VERCEL_ENV: "production",
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCommerceRemoteReadPilotEnabled({
        VERCEL_TARGET_ENV: "production",
        [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isCustomerRemoteReadPilotEnabled({
        VERCEL_ENV: "production",
        [CUSTOMER_REMOTE_READ_PILOT_ENV]: "true",
      }),
    ).toBe(false);
  });

  it("keeps WRITE off when WRITE=1 but READ is absent, including Production", () => {
    expect(
      isCommerceRemoteWritePilotEnabled({
        VERCEL_ENV: "production",
        [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isCustomerRemoteWritePilotEnabled({
        [CUSTOMER_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isTreatmentRemoteWritePilotEnabled({
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteWritePilotEnabled({
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }),
    ).toBe(false);
  });

  it("keeps Appointment WRITE/MUTATE calendar dependency", () => {
    expect(
      isAppointmentRemoteWritePilotEnabled({
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        VERCEL_ENV: "production",
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
  });

  it("leaves the current Preview verified matrix unchanged", () => {
    expect(isCustomerRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(true);
    expect(isAppointmentRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(true);
    expect(isTreatmentRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(true);
    expect(isCommerceRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(true);
    expect(isCommerceRemoteWritePilotEnabled(PREVIEW_VERIFIED)).toBe(true);
    expect(isCalendarRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(false);
    expect(isTodayRemoteReadPilotEnabled(PREVIEW_VERIFIED)).toBe(false);
    expect(isCustomerRemoteWritePilotEnabled(PREVIEW_VERIFIED)).toBe(false);
    expect(isAppointmentRemoteWritePilotEnabled(PREVIEW_VERIFIED)).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled(PREVIEW_VERIFIED)).toBe(false);
    expect(
      isTodayRemoteReadPilotEnabled({
        ...PREVIEW_VERIFIED,
        [TODAY_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
  });

  it("does not let global persistence flags turn remote pilots on", () => {
    const persistence = {
      BEAUTY_OS_PERSISTENCE: "supabase",
      BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
    };
    expect(isCustomerRemoteReadPilotEnabled(persistence)).toBe(false);
    expect(isCommerceRemoteWritePilotEnabled(persistence)).toBe(false);
    expect(
      isCommerceRemoteWritePilotEnabled({
        ...persistence,
        [COMMERCE_REMOTE_WRITE_PILOT_ENV]: "1",
        [COMMERCE_REMOTE_READ_PILOT_ENV]: "1",
      }),
    ).toBe(true);
  });
});
