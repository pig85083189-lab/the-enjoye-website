import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppointmentConflictError } from "./appointment-write-create";
import { resolveCalendarCreateSurface } from "./appointment-write-surface";
import { APPOINTMENT_WRITE_UI, appointmentWriteUserMessage } from "./appointment-write-ui-error";
import { AppointmentWritePilotDeniedError } from "./appointment-write-guard";
import { AppointmentWriteIntegrityError, AppointmentWriteRetryableError } from "./appointment-write-create";
import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";

describe("Phase 1C-6C calendar create surface", () => {
  it("enables Owner remote create and never falls back to local when write pilot is on", () => {
    expect(
      resolveCalendarCreateSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        canCreateAppointment: true,
      }),
    ).toEqual({ createEnabled: true, remoteCreate: true, localCreate: false });
    expect(
      resolveCalendarCreateSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        canCreateAppointment: false,
      }),
    ).toEqual({ createEnabled: false, remoteCreate: false, localCreate: false });
  });

  it("keeps Calendar read-only when write pilot is off", () => {
    expect(
      resolveCalendarCreateSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: false,
        canCreateAppointment: true,
      }),
    ).toEqual({ createEnabled: false, remoteCreate: false, localCreate: false });
  });

  it("preserves local create only when both pilots are off", () => {
    expect(
      resolveCalendarCreateSurface({
        calendarRemoteReadPilot: false,
        appointmentRemoteWritePilot: false,
        canCreateAppointment: true,
      }),
    ).toEqual({ createEnabled: true, remoteCreate: false, localCreate: true });
  });

  it("maps exclusion and foundation failures to user-safe text", () => {
    expect(appointmentWriteUserMessage(new AppointmentConflictError())).toBe(
      APPOINTMENT_WRITE_UI.conflict,
    );
    expect(
      appointmentWriteUserMessage(
        new Error(
          'insert appointment: conflicting key value violates exclusion constraint "appointments_staff_active_no_overlap"',
        ),
      ),
    ).toBe(APPOINTMENT_WRITE_UI.conflict);
    expect(appointmentWriteUserMessage(new AppointmentWriteRetryableError())).toBe(
      APPOINTMENT_WRITE_UI.retryable,
    );
    expect(appointmentWriteUserMessage(new AppointmentWriteIntegrityError())).toBe(
      APPOINTMENT_WRITE_UI.integrity,
    );
    expect(appointmentWriteUserMessage(new AppointmentWritePilotDeniedError())).toBe(
      APPOINTMENT_WRITE_UI.denied,
    );
    expect(
      appointmentWriteUserMessage(new IdentityCatalogError("unauthenticated", "No session")),
    ).toBe(APPOINTMENT_WRITE_UI.unauthenticated);
    expect(
      appointmentWriteUserMessage(new UnmappedIdentityError("customer", "org-a", "cust-x")),
    ).toBe(APPOINTMENT_WRITE_UI.mapping);
    expect(
      appointmentWriteUserMessage(new Error("Appointment write snapshot dependency is unmapped")),
    ).toBe(APPOINTMENT_WRITE_UI.snapshot);
    expect(appointmentWriteUserMessage(new Error("23P01 exclusion_violation"))).not.toMatch(
      /23P01|exclusion|postgres/i,
    );
  });

  it("keeps the write graph out of Calendar RSC and local mutation surfaces", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/calendar/page.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(process.cwd(), "features/calendar/use-calendar-remote-write.ts"),
      "utf8",
    );
    expect(page).toMatch(/appointment-remote-write-flag|appointment-remote-mutate-flag/);
    expect(page).not.toMatch(
      /appointment-remote-write-pilot|appointment-remote-mutate-pilot|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter|createBrowserClient/,
    );
    expect(calendar).toMatch(/use-calendar-remote-write|submitCalendarRemoteAppointmentCreate/);
    expect(calendar).not.toMatch(
      /createAuthenticatedAppointmentWritePersistence|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/,
    );
    expect(calendar).toMatch(/if \(remoteCreate\)/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCreate/);
    expect(calendar).toMatch(/createAppointment\(/);
    expect(calendar).toMatch(/appointment-write-customer-search/);
    expect(calendar).toMatch(/filterAppointmentWriteCustomers/);
    expect(calendar).not.toMatch(/phone: ""/);
    expect(hook).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(hook).toMatch(/createBrowserClientOrNull/);
    const remoteSave = calendar.slice(
      calendar.indexOf("if (!remoteSubmission)"),
      calendar.indexOf("if (initial) updateAppointment"),
    );
    expect(remoteSave).toMatch(/submitCalendarRemoteAppointmentCreate/);
    expect(remoteSave).not.toMatch(/createAppointment\(/);
    expect(remoteSave).not.toMatch(/updateAppointment\(/);
    expect(remoteSave).not.toMatch(/localStorage/);
  });
});
