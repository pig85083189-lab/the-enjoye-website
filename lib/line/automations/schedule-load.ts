import { isReminderEligibleStatus } from "@/lib/line/automations/appointment-reminder-schedule";
import { isLineAutomationId } from "@/lib/line/automations/catalog";
import { parseLineAutomationTimingConfig } from "@/lib/line/automations/rules";
import type {
  LineAutomationExistingJob,
  LineAutomationJobStatus,
  LineAutomationScheduleAppointment,
  LineAutomationScheduleCustomer,
  LineAutomationSchedulePackage,
  LineAutomationScheduleRule,
  LineAutomationScheduleSnapshot,
  LineAutomationScheduleTreatment,
} from "@/lib/line/automations/schedule-types";
import type { LineAutomationId } from "@/lib/line/automations/types";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";

export const LINE_AUTOMATION_SCHEDULE_CUSTOMER_COLUMNS = [
  "id",
  "app_id",
  "organization_id",
  "birthday",
  "status",
] as const;

export function publicScheduleId(row: { id?: string | null; app_id?: string | null }): string {
  const appId = typeof row.app_id === "string" ? row.app_id.trim() : "";
  if (appId) return appId;
  return typeof row.id === "string" ? row.id.trim() : "";
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.trim();
}

function asYmd(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

export function mapAutomationRules(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): LineAutomationScheduleRule[] {
  const rules: LineAutomationScheduleRule[] = [];
  for (const row of rows) {
    if (row.organization_id !== organizationId) continue;
    const automationType =
      typeof row.automation_type === "string"
        ? row.automation_type
        : typeof row.automation_id === "string"
          ? row.automation_id
          : "";
    if (!isLineAutomationId(automationType)) continue;
    const timingConfig = parseLineAutomationTimingConfig(row.timing_config);
    const selectedTimingIds =
      timingConfig?.selectedTimingIds ??
      (Array.isArray(row.timing_ids)
        ? row.timing_ids.filter((item): item is string => typeof item === "string")
        : []);
    const template =
      typeof row.message_template === "string"
        ? row.message_template
        : typeof row.template === "string"
          ? row.template
          : "";
    rules.push({
      organizationId,
      automationType,
      enabled: row.enabled === true,
      selectedTimingIds,
      template,
    });
  }
  return rules;
}

export function mapScheduleCustomers(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): LineAutomationScheduleCustomer[] {
  return rows.flatMap((row) => {
    const id = publicScheduleId(row);
    if (!id) return [];
    return [
      {
        id,
        organizationId,
        birthdayYmd: asYmd(row.birthday),
        status: typeof row.status === "string" ? row.status : null,
        verifiedLineBinding: false,
      } satisfies LineAutomationScheduleCustomer,
    ];
  });
}

export function mapScheduleAppointments(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
  customers: readonly LineAutomationScheduleCustomer[],
): LineAutomationScheduleAppointment[] {
  const customerIds = new Map(customers.map((customer) => [customer.id, customer.id]));
  return rows.flatMap((row) => {
    const id = publicScheduleId(row);
    const customerId = publicScheduleId({
      id: typeof row.customer_id === "string" ? row.customer_id : null,
      app_id: typeof row.customer_app_id === "string" ? row.customer_app_id : null,
    });
    const startAt = asIso(row.starts_at ?? row.start_at);
    if (!id || !customerId || !startAt) return [];
    return [
      {
        id,
        organizationId,
        customerId: customerIds.get(customerId) ?? customerId,
        startAt,
        status: (typeof row.status === "string" ? row.status : "DRAFT") as CanonicalAppointmentStatus,
      } satisfies LineAutomationScheduleAppointment,
    ];
  });
}

export function mapScheduleTreatments(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): LineAutomationScheduleTreatment[] {
  return rows.flatMap((row) => {
    const id = publicScheduleId(row);
    const customerId = publicScheduleId({
      id: typeof row.customer_id === "string" ? row.customer_id : null,
      app_id: typeof row.customer_app_id === "string" ? row.customer_app_id : null,
    });
    if (!id) return [];
    return [
      {
        id,
        organizationId,
        customerId,
        completedAt: asIso(row.completed_at),
        status: typeof row.status === "string" ? row.status : "",
      } satisfies LineAutomationScheduleTreatment,
    ];
  });
}

export function mapSchedulePackages(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): LineAutomationSchedulePackage[] {
  return rows.flatMap((row) => {
    const id = publicScheduleId(row);
    const customerId = publicScheduleId({
      id: typeof row.customer_id === "string" ? row.customer_id : null,
      app_id: typeof row.customer_app_id === "string" ? row.customer_app_id : null,
    });
    if (!id) return [];
    return [
      {
        id,
        organizationId,
        customerId,
        expiresAt: asIso(row.expires_at),
        status: typeof row.status === "string" ? row.status : "",
        source: "customer_package",
      } satisfies LineAutomationSchedulePackage,
    ];
  });
}

export function mapExistingAutomationJobs(
  rows: readonly Record<string, unknown>[],
  organizationId: string,
): LineAutomationExistingJob[] {
  return rows.flatMap((row) => {
    if (row.organization_id !== organizationId) return [];
    const automationType =
      typeof row.automation_type === "string" ? row.automation_type : "appointment_reminder";
    if (!isLineAutomationId(automationType)) return [];
    const id = typeof row.id === "string" ? row.id : "";
    const eventId =
      typeof row.event_id === "string"
        ? row.event_id
        : typeof row.appointment_app_id === "string"
          ? row.appointment_app_id
          : "";
    const customerId =
      typeof row.customer_id === "string"
        ? row.customer_id
        : typeof row.customer_app_id === "string"
          ? row.customer_app_id
          : "";
    const fingerprint = typeof row.fingerprint === "string" ? row.fingerprint : "";
    const scheduledFor = asIso(row.scheduled_for);
    const timingId = typeof row.timing_id === "string" ? row.timing_id : "";
    if (!id || !eventId || !customerId || !fingerprint || !scheduledFor || !timingId) return [];
    return [
      {
        id,
        organizationId,
        automationType,
        eventId,
        customerId,
        timingId,
        fingerprint,
        scheduledFor,
        status: (typeof row.status === "string" ? row.status : "scheduled") as LineAutomationJobStatus,
        messageSnapshot:
          typeof row.message_snapshot === "string"
            ? row.message_snapshot
            : typeof row.template === "string"
              ? row.template
              : "",
      } satisfies LineAutomationExistingJob,
    ];
  });
}

export function buildScheduleSnapshot(input: {
  organizationId: string;
  rules: readonly Record<string, unknown>[];
  customers?: readonly Record<string, unknown>[];
  appointments?: readonly Record<string, unknown>[];
  treatments?: readonly Record<string, unknown>[];
  packages?: readonly Record<string, unknown>[];
  jobs?: readonly Record<string, unknown>[];
  nowMs?: number;
}): LineAutomationScheduleSnapshot {
  const customers =
    input.customers === undefined
      ? undefined
      : mapScheduleCustomers(input.customers, input.organizationId);
  return {
    organizationId: input.organizationId,
    rules: mapAutomationRules(input.rules, input.organizationId),
    customers,
    appointments:
      input.appointments === undefined
        ? undefined
        : mapScheduleAppointments(input.appointments, input.organizationId, customers ?? []),
    treatments:
      input.treatments === undefined
        ? undefined
        : mapScheduleTreatments(input.treatments, input.organizationId),
    packages:
      input.packages === undefined
        ? undefined
        : mapSchedulePackages(input.packages, input.organizationId),
    holidayOccurrences: undefined,
    existingJobs: mapExistingAutomationJobs(input.jobs ?? [], input.organizationId),
    nowMs: input.nowMs,
  };
}

export function scheduleRuleIds(rules: readonly LineAutomationScheduleRule[]): LineAutomationId[] {
  return rules.filter((rule) => rule.enabled).map((rule) => rule.automationType);
}

export function appointmentStillSchedulable(status: string): boolean {
  return isReminderEligibleStatus(status as CanonicalAppointmentStatus);
}
