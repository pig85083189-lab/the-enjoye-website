import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { customerCreateAppointmentHref } from "./customer-360";
import {
  CUSTOMER_360_APPOINTMENT_CREATE_UNAVAILABLE_REASON,
  resolveCustomer360AppointmentCreateSurface,
} from "./customer-360-appointment-create-surface";

const CUSTOMER_ID = "cust-muvb8x0p-887ltc";
const CANONICAL_HREF = `/staff/calendar?create=1&customer=${CUSTOMER_ID}`;

describe("Phase 1C Customer 360 appointment-create surface", () => {
  it("re-enables 新增預約 / ＋安排預約 only when Appointment WRITE is on", () => {
    expect(
      resolveCustomer360AppointmentCreateSurface({
        customerId: CUSTOMER_ID,
        customerRemoteReadPilot: true,
        appointmentRemoteReadPilot: true,
        appointmentRemoteWritePilot: true,
      }),
    ).toEqual({
      mode: "remote-create",
      href: CANONICAL_HREF,
      disabled: false,
    });
    expect(
      resolveCustomer360AppointmentCreateSurface({
        customerId: CUSTOMER_ID,
        customerRemoteReadPilot: true,
        appointmentRemoteReadPilot: true,
        appointmentRemoteWritePilot: false,
      }),
    ).toEqual({
      mode: "remote-read-only",
      href: null,
      disabled: true,
      reason: CUSTOMER_360_APPOINTMENT_CREATE_UNAVAILABLE_REASON,
    });
    expect(
      resolveCustomer360AppointmentCreateSurface({
        customerId: CUSTOMER_ID,
        customerRemoteReadPilot: false,
        appointmentRemoteReadPilot: false,
        appointmentRemoteWritePilot: false,
      }),
    ).toEqual({
      mode: "local-create",
      href: CANONICAL_HREF,
      disabled: false,
    });
  });

  it("prefills the current canonical customer id and does not guess by name or phone", () => {
    expect(customerCreateAppointmentHref(CUSTOMER_ID)).toBe(CANONICAL_HREF);
    expect(CANONICAL_HREF).toContain(`customer=${CUSTOMER_ID}`);
    expect(CANONICAL_HREF).not.toMatch(/name=|phone=/);
  });

  it("keeps Customer 360 RSC on the write flag and Calendar as the only create flow", () => {
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    const profile = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerProfilePage.tsx"),
      "utf8",
    );
    const summary = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerSummaryPanel.tsx"),
      "utf8",
    );
    const calendar = readFileSync(
      path.join(process.cwd(), "features/calendar/CalendarPage.tsx"),
      "utf8",
    );
    expect(page).toMatch(/appointment-remote-write-flag/);
    expect(page).toMatch(/isAppointmentRemoteWritePilotEnabled/);
    expect(page).not.toMatch(
      /appointment-remote-write-pilot|AuthenticatedAppointmentTableStore|runAuthenticatedAppointmentWriteCreate/,
    );
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(profile).toMatch(/resolveCustomer360AppointmentCreateSurface/);
    expect(profile).toMatch(/appointmentRemoteWritePilot/);
    expect(profile).not.toMatch(
      /createAuthenticatedAppointmentWritePersistence|AppointmentRemoteAdapter|createBrowserClient/,
    );
    expect(summary).toMatch(/allowCreateAppointment/);
    expect(calendar).toMatch(/params.get\("create"\) !== "1"/);
    expect(calendar).toMatch(/customerId: params.get\("customer"\)/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCreate/);
  });
});
