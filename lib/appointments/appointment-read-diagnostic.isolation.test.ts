import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CUSTOMER_APP_ID,
  runAppointmentReadDiagnosticStages,
  sanitizeDiagnosticError,
  sanitizeDiagnosticText,
} from "./appointment-read-diagnostic";
import {
  APPOINTMENT_READ_DIAGNOSTIC_ROUTE,
  isAppointmentReadDiagnosticEnabled,
} from "./appointment-read-diagnostic-flag";
import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "./remote-readiness";
import type {
  IdentityQueryBuilder,
  IdentityQueryResult,
  IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";

const AUTH_UUID = "cd037b07-d6fe-49a3-91eb-9735ec65665c";

type Row = Record<string, unknown>;

class FakeQuery implements IdentityQueryBuilder {
  constructor(
    private readonly rows: Row[],
    private readonly filters: Array<{ column: string; value?: string; values?: string[] }> = [],
    private readonly error: { message: string } | null = null,
  ) {}

  eq(column: string, value: string): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, value }], this.error);
  }

  in(column: string, values: string[]): IdentityQueryBuilder {
    return new FakeQuery(this.rows, [...this.filters, { column, values }], this.error);
  }

  then<TResult1 = IdentityQueryResult, TResult2 = never>(
    onfulfilled?: ((value: IdentityQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (this.error) {
      return Promise.resolve({ data: null, error: this.error }).then(onfulfilled, onrejected);
    }
    const data = this.rows.filter((row) =>
      this.filters.every((filter) => {
        const current = row[filter.column];
        if (filter.values) return filter.values.includes(String(current));
        return current === filter.value;
      }),
    );
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function fakeClient(input: {
  userId: string | null;
  tables: Record<string, Row[]>;
  errors?: Record<string, string>;
}): IdentitySupabaseClient {
  return {
    auth: {
      async getUser() {
        return {
          data: { user: input.userId ? { id: input.userId } : null },
          error: null,
        };
      },
    },
    from(table: string) {
      return {
        select() {
          const message = input.errors?.[table];
          return new FakeQuery(input.tables[table] ?? [], [], message ? { message } : null);
        },
      };
    },
  };
}

function ownerClient(errors?: Record<string, string>) {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return fakeClient({
    userId: AUTH_UUID,
    errors,
    tables: {
      staff_auth_memberships: [
        {
          id: "mem-enjoye-owner",
          user_id: FUTURE_QA_APPOINTMENT.staffAppId,
          auth_user_id: AUTH_UUID,
          organization_id: FUTURE_QA_APPOINTMENT.organizationAppId,
          role: "OWNER",
          is_active: true,
        },
      ],
      organizations: [
        { id: FUTURE_QA_APPOINTMENT.organizationDbId, app_id: FUTURE_QA_APPOINTMENT.organizationAppId },
      ],
      locations: [
        {
          id: FUTURE_QA_APPOINTMENT.locationDbId,
          app_id: FUTURE_QA_APPOINTMENT.locationAppId,
          organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        },
      ],
      customers: [
        {
          id: FUTURE_QA_APPOINTMENT.customerDbId,
          app_id: FUTURE_QA_APPOINTMENT.customerAppId,
          organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        },
      ],
      services: [
        {
          id: FUTURE_QA_APPOINTMENT.serviceDbId,
          app_id: FUTURE_QA_APPOINTMENT.serviceAppId,
          organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
        },
      ],
      appointments: [
        {
          id: "b92c54a1-000e-4cf1-bbd3-837ce3312559",
          organization_id: FUTURE_QA_APPOINTMENT.organizationDbId,
          location_id: FUTURE_QA_APPOINTMENT.locationDbId,
          customer_id: FUTURE_QA_APPOINTMENT.customerDbId,
          service_id: FUTURE_QA_APPOINTMENT.serviceDbId,
          staff_id: FUTURE_QA_APPOINTMENT.staffAppId,
          app_id: "apt-muqrindw-yt0l5z",
          starts_at: startAt,
          ends_at: endAt,
          duration_minutes: 100,
          status: "BOOKED",
          customer_note: null,
          internal_note: null,
          customer_name_snapshot: FUTURE_QA_APPOINTMENT.customerName,
          service_name_snapshot: FUTURE_QA_APPOINTMENT.serviceName,
          staff_name_snapshot: FUTURE_QA_APPOINTMENT.staffName,
          status_reason: null,
          cancelled_at: null,
          cancelled_by: null,
          created_by: FUTURE_QA_APPOINTMENT.staffAppId,
          updated_by: null,
          created_at: "2026-10-02T09:30:20.517Z",
          updated_at: "2026-10-02T09:30:20.517Z",
        },
      ],
    },
  });
}

describe("Phase 1C-5C appointment read diagnostic", () => {
  it("is Preview-only and Production unavailable", () => {
    expect(APPOINTMENT_READ_DIAGNOSTIC_ROUTE).toBe("/staff/appointment-read-diagnostic");
    expect(isAppointmentReadDiagnosticEnabled({})).toBe(false);
    expect(
      isAppointmentReadDiagnosticEnabled({
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
      }),
    ).toBe(true);
    expect(
      isAppointmentReadDiagnosticEnabled({
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isAppointmentReadDiagnosticEnabled({
        BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT: "1",
        VERCEL_TARGET_ENV: "production",
      }),
    ).toBe(false);
  });

  it("runs stages A–H without throwing and without writing", async () => {
    const stages = await runAppointmentReadDiagnosticStages(ownerClient());
    expect(stages.map((stage) => stage.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(stages.every((stage) => stage.status === "PASS")).toBe(true);
    expect(DIAGNOSTIC_CUSTOMER_APP_ID).toBe("cust-muqh2jn6-xpjssl");
    const source = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-read-diagnostic.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(source).not.toMatch(/createServiceRoleClient/);
  });

  it("sanitizes tokens and keeps stage failures inside results", async () => {
    const sanitized = sanitizeDiagnosticText(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb cookie: sb-xx-auth-token=secret",
    );
    expect(sanitized).not.toMatch(/Bearer |eyJhbGci|sb-xx-auth-token=secret/i);
    expect(sanitized).toMatch(/\[redacted\]/);
    const caught = sanitizeDiagnosticError(new Error("access_token=super-secret"));
    expect(caught.message).not.toMatch(/super-secret/);

    const failed = await runAppointmentReadDiagnosticStages(
      ownerClient({ appointments: "permission denied for table appointments" }),
    );
    expect(failed.find((stage) => stage.id === "A")?.status).toBe("PASS");
    expect(failed.find((stage) => stage.id === "D")?.status).toBe("FAIL");
    expect(failed.find((stage) => stage.id === "D")?.error?.message).toMatch(/permission denied/);
  });

  it("keeps the diagnostic off CustomerProfilePage and Calendar / Today", () => {
    expect(
      existsSync(path.join(process.cwd(), "app/staff/(app)/appointment-read-diagnostic/page.tsx")),
    ).toBe(true);
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/appointment-read-diagnostic/page.tsx"),
      "utf8",
    );
    const client = readFileSync(
      path.join(process.cwd(), "features/appointments/AppointmentReadDiagnosticPage.tsx"),
      "utf8",
    );
    expect(page).toMatch(/appointment-read-diagnostic-flag/);
    expect(page).not.toMatch(/appointment-remote-read-pilot|createServiceRoleClient/);
    expect(client).not.toMatch(/from ["']@\/features\/customers/);
    expect(client).not.toMatch(/use-appointment-remote-read/);
    expect(client).toMatch(/window.addEventListener\("error"/);
    expect(client).toMatch(/unhandledrejection/);
    for (const file of [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/appointment-read-diagnostic|AppointmentReadDiagnosticPage/);
    }
  });
});
