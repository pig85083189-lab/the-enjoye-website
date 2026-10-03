/**
 * Temporary Owner diagnostic for Phase 1C-5C Live failure.
 * Read-only. Publishable/session client only. No business writes.
 * Server Components must not import this file.
 */

import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import {
  AuthenticatedAppointmentReadStore,
  dbAppointmentFromUnknown,
} from "@/lib/persistence/authenticated-appointment-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { FUTURE_QA_APPOINTMENT } from "@/lib/appointments/remote-readiness";
import type { DbAppointment } from "@/lib/persistence/operational-rows";

export const DIAGNOSTIC_CUSTOMER_APP_ID = FUTURE_QA_APPOINTMENT.customerAppId;

export type DiagnosticStageId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type SanitizedError = {
  name: string;
  message: string;
  stackLocation?: string;
};

export type DiagnosticStageResult = {
  id: DiagnosticStageId;
  label: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail?: Record<string, unknown>;
  error?: SanitizedError;
};

const SECRET_PATTERN =
  /bearer\s+\S+|authorization:\s*\S+|cookie:\s*[^\n]+|(?:access_token|refresh_token|id_token|api[_-]?key|service_role)[=:]\s*\S+|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|sb-[a-z0-9-]+-auth-token[^\s;]*|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/gi;

export function sanitizeDiagnosticText(value: string): string {
  return value.replace(SECRET_PATTERN, "[redacted]").slice(0, 400);
}

export function sanitizeDiagnosticError(error: unknown): SanitizedError {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const message =
    error instanceof Error && error.message
      ? sanitizeDiagnosticText(error.message)
      : "Unknown diagnostic error";
  const stack = error instanceof Error ? error.stack : undefined;
  let stackLocation: string | undefined;
  if (stack) {
    const lines = stack.split("\n").map((line) => line.trim());
    const appLine =
      lines.find(
        (line) =>
          /(?:features|lib|app)\//.test(line) && !line.includes("node_modules"),
      ) ?? lines.find((line) => line.startsWith("at ") && !line.includes("node_modules"));
    if (appLine) stackLocation = sanitizeDiagnosticText(appLine);
  }
  return { name: sanitizeDiagnosticText(name), message, stackLocation };
}

async function runStage(
  id: DiagnosticStageId,
  label: string,
  run: () => Promise<Record<string, unknown> | void>,
): Promise<DiagnosticStageResult> {
  try {
    const detail = (await run()) ?? {};
    return { id, label, status: "PASS", detail };
  } catch (error: unknown) {
    return { id, label, status: "FAIL", error: sanitizeDiagnosticError(error) };
  }
}

function skipStage(
  id: DiagnosticStageId,
  label: string,
  reason: string,
): DiagnosticStageResult {
  return { id, label, status: "SKIP", detail: { reason } };
}

function safeAppointmentFields(row: ScheduleAppointment): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    customerId: row.customerId,
    serviceId: row.serviceId,
    staffId: row.staffId,
    serviceName: row.serviceName,
    staffName: row.staffName,
    customerName: row.customerName,
    hasNotesArray: Array.isArray(row.notes),
  };
}

export async function runAppointmentReadDiagnosticStages(
  client: IdentitySupabaseClient,
  customerAppId: string = DIAGNOSTIC_CUSTOMER_APP_ID,
): Promise<DiagnosticStageResult[]> {
  const results: DiagnosticStageResult[] = [];
  let identity: LoadedAuthenticatedIdentity | undefined;
  let customerDbId: string | undefined;
  let rawRows: DbAppointment[] = [];
  let mapped: ScheduleAppointment[] = [];

  results.push(
    await runStage("A", "auth.getUser()", async () => {
      const session = await client.auth.getUser();
      if (session.error) throw new Error(session.error.message);
      if (!session.data.user?.id) throw new Error("No authenticated session");
      return {
        authenticated: true,
        userIdPresent: true,
      };
    }),
  );
  if (results[0]?.status !== "PASS") {
    return [
      ...results,
      skipStage("B", "loadAuthenticatedIdentityCatalog", "Stage A failed"),
      skipStage("C", "resolve customer app id → UUID", "Stage A failed"),
      skipStage("D", "AuthenticatedAppointmentReadStore query", "Stage A failed"),
      skipStage("E", "raw row shape validation", "Stage A failed"),
      skipStage("F", "AppointmentRemoteAdapter mapping", "Stage A failed"),
      skipStage("G", "ScheduleAppointment mapped object validation", "Stage A failed"),
      skipStage("H", "formatTaipeiAppointmentDisplay", "Stage A failed"),
    ];
  }

  results.push(
    await runStage("B", "loadAuthenticatedIdentityCatalog", async () => {
      identity = await loadAuthenticatedIdentityCatalog(client);
      return {
        organizationAppId: identity.organizationAppId,
        operationalStaffId: identity.operationalStaffId,
        catalogReady: true,
      };
    }),
  );
  if (!identity) {
    return [
      ...results,
      skipStage("C", "resolve customer app id → UUID", "Stage B failed"),
      skipStage("D", "AuthenticatedAppointmentReadStore query", "Stage B failed"),
      skipStage("E", "raw row shape validation", "Stage B failed"),
      skipStage("F", "AppointmentRemoteAdapter mapping", "Stage B failed"),
      skipStage("G", "ScheduleAppointment mapped object validation", "Stage B failed"),
      skipStage("H", "formatTaipeiAppointmentDisplay", "Stage B failed"),
    ];
  }

  const loaded = identity;
  results.push(
    await runStage("C", "resolve customer app id → UUID", async () => {
      customerDbId = loaded.mapper.resolveCustomerDbId(loaded.organizationAppId, customerAppId);
      return {
        customerAppId,
        customerDbIdPresent: Boolean(customerDbId),
        customerDbIdLooksLikeUuid: /^[0-9a-f-]{36}$/i.test(customerDbId ?? ""),
      };
    }),
  );
  if (!customerDbId) {
    return [
      ...results,
      skipStage("D", "AuthenticatedAppointmentReadStore query", "Stage C failed"),
      skipStage("E", "raw row shape validation", "Stage C failed"),
      skipStage("F", "AppointmentRemoteAdapter mapping", "Stage C failed"),
      skipStage("G", "ScheduleAppointment mapped object validation", "Stage C failed"),
      skipStage("H", "formatTaipeiAppointmentDisplay", "Stage C failed"),
    ];
  }

  const resolvedCustomerDbId = customerDbId;
  results.push(
    await runStage("D", "AuthenticatedAppointmentReadStore query", async () => {
      const store = new AuthenticatedAppointmentReadStore(client);
      rawRows = await store.listAppointmentsByCustomer(loaded.organizationDbId, resolvedCustomerDbId);
      return {
        rowCount: rawRows.length,
        readOnly: true,
      };
    }),
  );

  results.push(
    await runStage("E", "raw row shape validation", async () => {
      if (rawRows.length === 0) {
        return { rowCount: 0, note: "No remote appointment rows for this customer" };
      }
      const validated = rawRows.map((row) =>
        dbAppointmentFromUnknown(row as unknown as Record<string, unknown>),
      );
      return {
        rowCount: validated.length,
        rows: validated.map((row) => ({
          app_id: row.app_id,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          status: row.status,
          staff_id: row.staff_id,
          customer_app_id: customerAppId,
          service_app_id: loaded.mapper.toServiceAppId(row.service_id),
          location_app_id: row.location_id ? loaded.mapper.toLocationAppId(row.location_id) : "",
        })),
      };
    }),
  );

  results.push(
    await runStage("F", "AppointmentRemoteAdapter mapping", async () => {
      const adapter = new AppointmentRemoteAdapter(
        loaded.mapper,
        new AuthenticatedAppointmentReadStore(client),
      );
      mapped = await adapter.listByCustomerId(loaded.organizationAppId, customerAppId);
      return {
        mappedCount: mapped.length,
        ids: mapped.map((row) => row.id),
      };
    }),
  );

  results.push(
    await runStage("G", "ScheduleAppointment mapped object validation", async () => {
      if (mapped.length === 0) {
        return { mappedCount: 0 };
      }
      for (const row of mapped) {
        if (!row.id || !row.startAt || !row.endAt || !row.status) {
          throw new Error("Mapped ScheduleAppointment is missing required fields");
        }
        if (!Array.isArray(row.notes)) {
          throw new Error("Mapped ScheduleAppointment.notes is not an array");
        }
      }
      return {
        mappedCount: mapped.length,
        appointments: mapped.map(safeAppointmentFields),
      };
    }),
  );

  results.push(
    await runStage("H", "formatTaipeiAppointmentDisplay", async () => {
      if (mapped.length === 0) {
        return { mappedCount: 0 };
      }
      return {
        displays: mapped.map((row) => ({
          id: row.id,
          ...formatTaipeiAppointmentDisplay(row.startAt, row.endAt),
        })),
      };
    }),
  );

  return results;
}
