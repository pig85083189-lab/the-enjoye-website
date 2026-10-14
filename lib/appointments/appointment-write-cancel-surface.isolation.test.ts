import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAppointmentRemoteMutatePilotEnabled } from "./appointment-remote-mutate-flag";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV } from "./appointment-remote-write-flag";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "./calendar-remote-read-flag";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "./appointment-remote-mutate-flag";
import {
  isCalendarRemoteCancelEligible,
  isCalendarRemoteRescheduleEligible,
  resolveCalendarCancelSurface,
  resolveCalendarQuickViewActions,
  resolveCalendarRescheduleSurface,
} from "./appointment-write-cancel-surface";
import {
  AppointmentRescheduleSubmission,
  appointmentRescheduleDisabled,
} from "./appointment-write-reschedule-submit";
import {
  APPOINTMENT_RESCHEDULE_UI,
  appointmentRescheduleUserMessage,
} from "./appointment-write-reschedule-ui-error";
import {
  AppointmentCancelSubmission,
  appointmentCancelDisabled,
} from "./appointment-write-cancel-submit";
import {
  APPOINTMENT_CANCEL_UI,
  appointmentCancelUserMessage,
} from "./appointment-write-cancel-ui-error";
import { AppointmentWriteStaleError } from "./appointment-write-mutate-errors";
import { AppointmentWritePilotDeniedError } from "./appointment-write-guard";

const MUTATE_ON = {
  [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
  [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
  [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
};

describe("Phase 1C-6D.2 calendar remote cancel surface", () => {
  it("keeps remote Cancel off unless mutate + Owner are on", () => {
    expect(isAppointmentRemoteMutatePilotEnabled({})).toBe(false);
    expect(
      isAppointmentRemoteMutatePilotEnabled({
        ...MUTATE_ON,
        VERCEL_ENV: "production",
      }),
    ).toBe(true);
    expect(
      resolveCalendarCancelSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        appointmentRemoteMutatePilot: false,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteCancelAvailable: false, localCancel: false });
    expect(
      resolveCalendarCancelSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        appointmentRemoteMutatePilot: true,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteCancelAvailable: true, localCancel: false });
    expect(
      resolveCalendarCancelSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        appointmentRemoteMutatePilot: true,
        authenticatedOwner: false,
      }),
    ).toEqual({ remoteCancelAvailable: false, localCancel: false });
  });

  it("preserves local Cancel only when all remote pilots are off", () => {
    expect(
      resolveCalendarCancelSurface({
        calendarRemoteReadPilot: false,
        appointmentRemoteWritePilot: false,
        appointmentRemoteMutatePilot: false,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteCancelAvailable: false, localCancel: true });
  });

  it("requires a verified remote appointment, expectedUpdatedAt, and CANCELLED transition", () => {
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "BOOKED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
        status: "BOOKED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "IN_SERVICE",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "BOOKED",
        updatedAt: "",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteCancelEligible({
        remoteCancelAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "CANCELLED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      resolveCalendarQuickViewActions({
        readOnly: true,
        allowRemoteCancel: true,
        status: "CANCELLED",
      }),
    ).toEqual({ canEdit: false, canCancel: false, canTransition: false });
  });

  it("exposes Cancel only and keeps Edit / status actions disabled while remote-read", () => {
    expect(
      resolveCalendarQuickViewActions({
        readOnly: true,
        allowRemoteCancel: true,
        status: "BOOKED",
      }),
    ).toEqual({ canEdit: false, canCancel: true, canTransition: false });
    expect(
      resolveCalendarQuickViewActions({
        readOnly: true,
        allowRemoteCancel: true,
        allowRemoteReschedule: true,
        status: "BOOKED",
      }),
    ).toEqual({ canEdit: true, canCancel: true, canTransition: false });
    expect(
      resolveCalendarQuickViewActions({
        readOnly: true,
        allowRemoteCancel: false,
        status: "BOOKED",
      }),
    ).toEqual({ canEdit: false, canCancel: false, canTransition: false });
    expect(
      resolveCalendarQuickViewActions({
        readOnly: false,
        allowRemoteCancel: false,
        status: "BOOKED",
      }),
    ).toEqual({ canEdit: true, canCancel: true, canTransition: true });
  });

  it("guards duplicate cancel submit and maps stale writes to user-safe text", async () => {
    const submission = new AppointmentCancelSubmission<string>();
    const first = submission.submit(async () => "ok");
    const second = submission.submit(async () => "again");
    expect(await second).toBe("ignored");
    expect(await first).toBe("success");
    expect(submission.cancelRequests).toBe(1);
    expect(appointmentCancelDisabled(submission.phase)).toBe(true);
    await expect(submission.submit(async () => "late")).rejects.toThrow(
      /already succeeded/,
    );
    expect(appointmentCancelUserMessage(new AppointmentWriteStaleError())).toBe(
      APPOINTMENT_CANCEL_UI.stale,
    );
    expect(appointmentCancelUserMessage(new AppointmentWritePilotDeniedError())).toBe(
      APPOINTMENT_CANCEL_UI.denied,
    );
    expect(appointmentCancelUserMessage(new Error("23P01 exclusion_violation"))).not.toMatch(
      /23P01|exclusion|postgres/i,
    );
  });

  it("wires Calendar Cancel to remote mutate without enabling other mutations", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/calendar/page.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const quickView = readFileSync(
      path.join(process.cwd(), "features/calendar/AppointmentQuickView.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(process.cwd(), "features/calendar/use-calendar-remote-cancel.ts"),
      "utf8",
    );
    const today = readFileSync(
      path.join(process.cwd(), "features/today/TodayDashboard.tsx"),
      "utf8",
    );
    const profile = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    expect(page).toMatch(/isAppointmentRemoteMutatePilotEnabled/);
    expect(page).not.toMatch(/appointment-remote-mutate-pilot|createBrowserClient/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentReschedule/);
    expect(calendar).toMatch(/expectedUpdatedAt: cancelItem.updatedAt/);
    expect(calendar).toMatch(/kind: "cancel"|status: "CANCELLED"|submitCalendarRemoteAppointmentCancel/);
    expect(calendar).toMatch(/readOnly=\{calendarRemoteReadPilot\}/);
    expect(calendar).toMatch(/allowRemoteCancel=\{allowRemoteCancel\}/);
    expect(calendar).toMatch(/allowRemoteReschedule=\{allowRemoteReschedule\}/);
    const remoteConfirm = calendar.slice(
      calendar.indexOf("await submitCalendarRemoteAppointmentCancel"),
      calendar.indexOf("if (!cancelSurface.localCancel)"),
    );
    expect(remoteConfirm).toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(remoteConfirm).not.toMatch(/transitionAppointmentStatus/);
    expect(remoteConfirm).not.toMatch(/updateAppointment/);
    expect(remoteConfirm).not.toMatch(/setAppointmentStatus/);
    expect(remoteConfirm).not.toMatch(/createAppointment\(/);
    expect(quickView).toMatch(/allowRemoteCancel/);
    expect(quickView).toMatch(/allowRemoteReschedule/);
    expect(quickView).toMatch(/行事曆遠端讀取試點為唯讀/);
    expect(quickView).toMatch(/遠端預約目前僅能取消/);
    expect(quickView).toMatch(/遠端預約可改期或取消/);
    expect(quickView).toMatch(/AppointmentCancelSubmission/);
    expect(hook).toMatch(/kind: "cancel"/);
    expect(hook).toMatch(/expectedUpdatedAt/);
    expect(hook).toMatch(/status: "CANCELLED"/);
    expect(hook).toMatch(/statusReason: input.statusReason/);
    expect(hook).toMatch(/emitAppointmentRemoteWriteRefresh/);
    expect(hook).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|\.upsert\(/);
    expect(hook).not.toMatch(/updateAppointment|transitionAppointmentStatus|localStorage/);
    expect(today).not.toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(profile).not.toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(today).toMatch(/readOnly=\{todayRemoteReadPilot\}/);
    expect(profile).toMatch(/readOnly=\{remoteReadPilot\}/);
  });

  it("opens remote Reschedule only for mutate + Owner + generated appointment", () => {
    expect(
      resolveCalendarRescheduleSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        appointmentRemoteMutatePilot: false,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteRescheduleAvailable: false, localReschedule: false });
    expect(
      resolveCalendarRescheduleSurface({
        calendarRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
        appointmentRemoteMutatePilot: true,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteRescheduleAvailable: true, localReschedule: false });
    expect(
      resolveCalendarRescheduleSurface({
        calendarRemoteReadPilot: false,
        appointmentRemoteWritePilot: false,
        appointmentRemoteMutatePilot: false,
        authenticatedOwner: true,
      }),
    ).toEqual({ remoteRescheduleAvailable: false, localReschedule: true });
    expect(
      isCalendarRemoteRescheduleEligible({
        remoteRescheduleAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "BOOKED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isCalendarRemoteRescheduleEligible({
        remoteRescheduleAvailable: true,
        appointmentId: "apt-muqrindw-yt0l5z",
        status: "ARRIVED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isCalendarRemoteRescheduleEligible({
        remoteRescheduleAvailable: true,
        appointmentId: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
        status: "BOOKED",
        updatedAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("guards duplicate reschedule submit and never pretends a failed write succeeded", async () => {
    const submission = new AppointmentRescheduleSubmission<string>();
    const first = submission.submit(async () => "ok");
    const second = submission.submit(async () => "again");
    expect(await second).toBe("ignored");
    expect(await first).toBe("success");
    expect(submission.rescheduleRequests).toBe(1);
    expect(appointmentRescheduleDisabled(submission.phase)).toBe(true);
    const failed = new AppointmentRescheduleSubmission<string>();
    expect(await failed.submit(async () => {
      throw new AppointmentWriteStaleError();
    })).toBe("error");
    expect(failed.phase).toBe("error");
    expect(appointmentRescheduleUserMessage(new AppointmentWriteStaleError())).toBe(
      APPOINTMENT_RESCHEDULE_UI.stale,
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      path.join(process.cwd(), "features/calendar/use-calendar-remote-reschedule.ts"),
      "utf8",
    );
    const remoteSave = calendar.slice(
      calendar.indexOf("if (remoteReschedule)"),
      calendar.indexOf("if (remoteCreate)"),
    );
    expect(remoteSave).toMatch(/submitCalendarRemoteAppointmentReschedule/);
    expect(remoteSave).not.toMatch(/updateAppointment/);
    expect(remoteSave).not.toMatch(/createAppointment\(/);
    expect(remoteSave).toMatch(/appointmentRescheduleUserMessage/);
    expect(hook).toMatch(/kind: "reschedule"/);
    expect(hook).toMatch(/expectedUpdatedAt/);
    expect(hook).toMatch(/runAuthenticatedAppointmentWriteMutate/);
    expect(hook).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|\.upsert\(/);
    expect(hook).not.toMatch(/updateAppointment|localStorage/);
  });
});
