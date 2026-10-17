import { isLineAutomationId, lineAutomationBuiltinTimingIds } from "@/lib/line/automations/catalog";
import { isReminderEligibleStatus } from "@/lib/line/automations/appointment-reminder-schedule";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import {
  LINE_COUPON_CATALOG_READY,
  LINE_HOLIDAY_CALENDAR_READY,
  LINE_AUTOMATION_SCHEDULE_TIMEZONE,
  type LineAutomationDependencyId,
  type LineAutomationProposedJob,
  type LineAutomationScheduleAppointment,
  type LineAutomationScheduleCustomer,
  type LineAutomationSchedulePlan,
  type LineAutomationScheduleRule,
  type LineAutomationScheduleSnapshot,
  type LineAutomationSkippedCandidate,
} from "@/lib/line/automations/schedule-types";
import {
  automationJobFingerprint,
  computeAutomationFireAt,
} from "@/lib/line/automations/schedule-fire-at";
import type { LineAutomationId } from "@/lib/line/automations/types";
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";

function sameOrg(organizationId: string, rowOrganizationId: string): boolean {
  return organizationId === rowOrganizationId && organizationId.startsWith("org-");
}

function ruleFor(
  rules: readonly LineAutomationScheduleRule[],
  organizationId: string,
  automationType: LineAutomationId,
): LineAutomationScheduleRule | null {
  return (
    rules.find(
      (rule) =>
        rule.organizationId === organizationId && rule.automationType === automationType,
    ) ?? null
  );
}

function skip(
  organizationId: string,
  automationType: LineAutomationId,
  decision: LineAutomationSkippedCandidate["decision"],
  reason: string,
  extra?: Partial<LineAutomationSkippedCandidate>,
): LineAutomationSkippedCandidate {
  return {
    organizationId,
    automationType,
    decision,
    reason,
    ...extra,
  };
}

function propose(input: {
  organizationId: string;
  automationType: LineAutomationId;
  eventKind: LineAutomationProposedJob["eventKind"];
  eventId: string;
  customerId: string;
  timingId: string;
  fireAt: string;
  template: string;
  recipientReady: boolean;
}): LineAutomationProposedJob {
  return {
    organizationId: input.organizationId,
    automationType: input.automationType,
    eventKind: input.eventKind,
    eventId: input.eventId,
    customerId: input.customerId,
    timingId: input.timingId,
    fingerprint: automationJobFingerprint(input),
    fireAt: input.fireAt,
    messageSnapshot: input.template,
    recipientReady: input.recipientReady,
    decision: input.recipientReady ? "planned" : "pending_recipient",
  };
}

function selectedBuiltinTimings(
  automationType: LineAutomationId,
  selectedTimingIds: string[],
): { builtin: string[]; unsupported: string[] } {
  const allowed = lineAutomationBuiltinTimingIds(automationType) ?? [];
  const builtin: string[] = [];
  const unsupported: string[] = [];
  for (const timingId of selectedTimingIds) {
    if (allowed.includes(timingId)) builtin.push(timingId);
    else unsupported.push(timingId);
  }
  return { builtin, unsupported };
}

function customerById(
  customers: readonly LineAutomationScheduleCustomer[],
  organizationId: string,
  customerId: string,
): LineAutomationScheduleCustomer | null {
  return (
    customers.find(
      (customer) => customer.id === customerId && customer.organizationId === organizationId,
    ) ?? null
  );
}

function isEligibleCustomer(customer: LineAutomationScheduleCustomer | null): boolean {
  if (!customer?.id) return false;
  if (customer.status != null && customer.status !== "ACTIVE") return false;
  return true;
}

export function planLineAutomationSchedule(
  snapshot: LineAutomationScheduleSnapshot,
): LineAutomationSchedulePlan {
  const organizationId = snapshot.organizationId.trim();
  const skipped: LineAutomationSkippedCandidate[] = [];
  const proposed: LineAutomationProposedJob[] = [];
  const missingDependencies: LineAutomationDependencyId[] = [];
  const nowMs = snapshot.nowMs ?? Date.now();
  const nowTaipeiYmd = utcIsoToTaipeiLocal(new Date(nowMs).toISOString()).dateYmd;
  const rules = snapshot.rules.filter((rule) => sameOrg(organizationId, rule.organizationId));
  const customers = (snapshot.customers ?? []).filter((row) => sameOrg(organizationId, row.organizationId));
  const appointments = (snapshot.appointments ?? []).filter((row) =>
    sameOrg(organizationId, row.organizationId),
  );
  const treatments = (snapshot.treatments ?? []).filter((row) =>
    sameOrg(organizationId, row.organizationId),
  );
  const packages = (snapshot.packages ?? []).filter((row) => sameOrg(organizationId, row.organizationId));

  if (LINE_AUTOMATION_SEND_OPEN !== false) {
    return {
      organizationId,
      proposed: [],
      skipped: [
        skip(organizationId, "appointment_reminder", "blocked_send_closed", "自動發送開關異常，已停止排程"),
      ],
      missingDependencies,
      sendOpen: false,
    };
  }

  planAppointments({ organizationId, rules, appointments, customers, nowMs, nowTaipeiYmd, proposed, skipped });
  planBirthdays({ organizationId, rules, customers, nowMs, nowTaipeiYmd, proposed, skipped });
  planHolidays({
    organizationId,
    rules,
    customers,
    holidayOccurrences: snapshot.holidayOccurrences ?? [],
    nowMs,
    nowTaipeiYmd,
    proposed,
    skipped,
    missingDependencies,
  });
  planSurveys({ organizationId, rules, treatments, customers, nowMs, nowTaipeiYmd, proposed, skipped });
  planPackages({
    organizationId,
    rules,
    packages,
    customers,
    nowMs,
    nowTaipeiYmd,
    proposed,
    skipped,
    missingDependencies,
  });

  return {
    organizationId,
    proposed,
    skipped,
    missingDependencies,
    sendOpen: false,
  };
}

function planAppointments(input: {
  organizationId: string;
  rules: LineAutomationScheduleRule[];
  appointments: LineAutomationScheduleAppointment[];
  customers: LineAutomationScheduleCustomer[];
  nowMs: number;
  nowTaipeiYmd: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
}): void {
  const type = "appointment_reminder";
  const rule = ruleFor(input.rules, input.organizationId, type);
  if (!rule?.enabled) {
    input.skipped.push(skip(input.organizationId, type, "skipped_disabled", "店長尚未啟用預約提醒"));
    return;
  }
  const timings = selectedBuiltinTimings(type, rule.selectedTimingIds);
  for (const timingId of timings.unsupported) {
    input.skipped.push(
      skip(input.organizationId, type, "skipped_unsupported_timing", "自訂時間沒有可計算的發送定義", {
        timingId,
      }),
    );
  }
  for (const appointment of input.appointments) {
    if (!appointment.id || !appointment.customerId || !appointment.startAt) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "預約資料不足，略過排程", {
          eventId: appointment.id,
          customerId: appointment.customerId,
        }),
      );
      continue;
    }
    if (!isReminderEligibleStatus(appointment.status)) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_ineligible", "預約狀態不可發送提醒", {
          eventId: appointment.id,
          customerId: appointment.customerId,
        }),
      );
      continue;
    }
    const customer = customerById(input.customers, input.organizationId, appointment.customerId);
    if (!customer || !isEligibleCustomer(customer)) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "顧客資料不足，略過排程", {
          eventId: appointment.id,
          customerId: appointment.customerId,
        }),
      );
      continue;
    }
    pushTimingJobs({
      organizationId: input.organizationId,
      automationType: type,
      eventKind: "appointment",
      eventId: appointment.id,
      customerId: appointment.customerId,
      timings: timings.builtin,
      template: rule.template,
      recipientReady: customer.verifiedLineBinding === true,
      nowMs: input.nowMs,
      fireAtFor: (timingId) =>
        computeAutomationFireAt({
          automationType: type,
          timingId,
          eventKind: "appointment",
          startAt: appointment.startAt,
          nowTaipeiYmd: input.nowTaipeiYmd,
        }),
      proposed: input.proposed,
      skipped: input.skipped,
    });
  }
}

function planBirthdays(input: {
  organizationId: string;
  rules: LineAutomationScheduleRule[];
  customers: LineAutomationScheduleCustomer[];
  nowMs: number;
  nowTaipeiYmd: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
}): void {
  const type = "birthday_greeting";
  const rule = ruleFor(input.rules, input.organizationId, type);
  if (!rule?.enabled) {
    input.skipped.push(skip(input.organizationId, type, "skipped_disabled", "店長尚未啟用生日祝福"));
    return;
  }
  const timings = selectedBuiltinTimings(type, rule.selectedTimingIds);
  for (const customer of input.customers) {
    if (!isEligibleCustomer(customer)) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_ineligible", "顧客狀態不可發送生日祝福", {
          customerId: customer.id,
          eventId: customer.id,
        }),
      );
      continue;
    }
    if (!customer.birthdayYmd) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "顧客生日不足，略過排程", {
          customerId: customer.id,
          eventId: customer.id,
        }),
      );
      continue;
    }
    pushTimingJobs({
      organizationId: input.organizationId,
      automationType: type,
      eventKind: "customer_birthday",
      eventId: customer.id,
      customerId: customer.id,
      timings: timings.builtin,
      template: rule.template,
      recipientReady: customer.verifiedLineBinding === true,
      nowMs: input.nowMs,
      fireAtFor: (timingId) =>
        computeAutomationFireAt({
          automationType: type,
          timingId,
          eventKind: "customer_birthday",
          birthdayYmd: customer.birthdayYmd,
          nowTaipeiYmd: input.nowTaipeiYmd,
        }),
      proposed: input.proposed,
      skipped: input.skipped,
    });
  }
}

function planHolidays(input: {
  organizationId: string;
  rules: LineAutomationScheduleRule[];
  customers: LineAutomationScheduleCustomer[];
  holidayOccurrences: LineAutomationScheduleSnapshot["holidayOccurrences"];
  nowMs: number;
  nowTaipeiYmd: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
  missingDependencies: LineAutomationDependencyId[];
}): void {
  const type = "holiday_greeting";
  const rule = ruleFor(input.rules, input.organizationId, type);
  if (!rule?.enabled) {
    input.skipped.push(skip(input.organizationId, type, "skipped_disabled", "店長尚未啟用節慶祝福"));
    return;
  }
  const occurrences = (input.holidayOccurrences ?? []).filter((row) =>
    rule.selectedTimingIds.includes(row.holidayId),
  );
  if (!LINE_HOLIDAY_CALENDAR_READY && occurrences.length === 0) {
    input.missingDependencies.push("holiday_calendar");
    input.skipped.push(
      skip(input.organizationId, type, "blocked_missing_source", "正式節日日期來源尚未完成，不建立節慶排程"),
    );
    return;
  }
  for (const occurrence of occurrences) {
    for (const customer of input.customers) {
      if (!isEligibleCustomer(customer)) {
        input.skipped.push(
          skip(input.organizationId, type, "skipped_ineligible", "顧客狀態不可發送節慶祝福", {
            customerId: customer.id,
            eventId: `${occurrence.id}:${customer.id}`,
          }),
        );
        continue;
      }
      pushTimingJobs({
        organizationId: input.organizationId,
        automationType: type,
        eventKind: "holiday_occurrence",
        eventId: `${occurrence.id}:${customer.id}`,
        customerId: customer.id,
        timings: [occurrence.holidayId],
        template: rule.template,
        recipientReady: customer.verifiedLineBinding === true,
        nowMs: input.nowMs,
        fireAtFor: (timingId) =>
          computeAutomationFireAt({
            automationType: type,
            timingId,
            eventKind: "holiday_occurrence",
            holidayDateYmd: occurrence.dateYmd,
            nowTaipeiYmd: input.nowTaipeiYmd,
          }),
        proposed: input.proposed,
        skipped: input.skipped,
      });
    }
  }
}

function planSurveys(input: {
  organizationId: string;
  rules: LineAutomationScheduleRule[];
  treatments: NonNullable<LineAutomationScheduleSnapshot["treatments"]>;
  customers: LineAutomationScheduleCustomer[];
  nowMs: number;
  nowTaipeiYmd: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
}): void {
  const type = "satisfaction_survey";
  const rule = ruleFor(input.rules, input.organizationId, type);
  if (!rule?.enabled) {
    input.skipped.push(skip(input.organizationId, type, "skipped_disabled", "店長尚未啟用滿意度調查"));
    return;
  }
  const timings = selectedBuiltinTimings(type, rule.selectedTimingIds);
  for (const treatment of input.treatments) {
    if (treatment.status !== "COMPLETED" || !treatment.completedAt || !treatment.customerId) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "服務完成資料不足，略過排程", {
          eventId: treatment.id,
          customerId: treatment.customerId,
        }),
      );
      continue;
    }
    const customer = customerById(input.customers, input.organizationId, treatment.customerId);
    if (!customer || !isEligibleCustomer(customer)) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "顧客資料不足，略過排程", {
          eventId: treatment.id,
          customerId: treatment.customerId,
        }),
      );
      continue;
    }
    pushTimingJobs({
      organizationId: input.organizationId,
      automationType: type,
      eventKind: "treatment",
      eventId: treatment.id,
      customerId: treatment.customerId,
      timings: timings.builtin,
      template: rule.template,
      recipientReady: customer.verifiedLineBinding === true,
      nowMs: input.nowMs,
      fireAtFor: (timingId) =>
        computeAutomationFireAt({
          automationType: type,
          timingId,
          eventKind: "treatment",
          completedAt: treatment.completedAt,
          nowTaipeiYmd: input.nowTaipeiYmd,
        }),
      proposed: input.proposed,
      skipped: input.skipped,
    });
  }
}

function planPackages(input: {
  organizationId: string;
  rules: LineAutomationScheduleRule[];
  packages: NonNullable<LineAutomationScheduleSnapshot["packages"]>;
  customers: LineAutomationScheduleCustomer[];
  nowMs: number;
  nowTaipeiYmd: string;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
  missingDependencies: LineAutomationDependencyId[];
}): void {
  const type = "coupon_expiry";
  const rule = ruleFor(input.rules, input.organizationId, type);
  if (!rule?.enabled) {
    input.skipped.push(skip(input.organizationId, type, "skipped_disabled", "店長尚未啟用優惠券到期提醒"));
    return;
  }
  if (!LINE_COUPON_CATALOG_READY && input.packages.length === 0) {
    input.missingDependencies.push("coupon_catalog");
    input.skipped.push(
      skip(
        input.organizationId,
        type,
        "blocked_missing_source",
        "正式優惠券目錄尚未完成；沒有套票到期日時不建立排程",
      ),
    );
    return;
  }
  const timings = selectedBuiltinTimings(type, rule.selectedTimingIds);
  for (const pack of input.packages) {
    if (pack.source !== "customer_package" || pack.status !== "ACTIVE" || !pack.expiresAt || !pack.customerId) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "套票到期資料不足，略過排程", {
          eventId: pack.id,
          customerId: pack.customerId,
        }),
      );
      continue;
    }
    const customer = customerById(input.customers, input.organizationId, pack.customerId);
    if (!customer || !isEligibleCustomer(customer)) {
      input.skipped.push(
        skip(input.organizationId, type, "skipped_missing_data", "顧客資料不足，略過排程", {
          eventId: pack.id,
          customerId: pack.customerId,
        }),
      );
      continue;
    }
    pushTimingJobs({
      organizationId: input.organizationId,
      automationType: type,
      eventKind: "customer_package",
      eventId: pack.id,
      customerId: pack.customerId,
      timings: timings.builtin,
      template: rule.template,
      recipientReady: customer.verifiedLineBinding === true,
      nowMs: input.nowMs,
      fireAtFor: (timingId) =>
        computeAutomationFireAt({
          automationType: type,
          timingId,
          eventKind: "customer_package",
          expiresAt: pack.expiresAt,
          nowTaipeiYmd: input.nowTaipeiYmd,
        }),
      proposed: input.proposed,
      skipped: input.skipped,
    });
  }
}

function pushTimingJobs(input: {
  organizationId: string;
  automationType: LineAutomationId;
  eventKind: LineAutomationProposedJob["eventKind"];
  eventId: string;
  customerId: string;
  timings: string[];
  template: string;
  recipientReady: boolean;
  nowMs: number;
  fireAtFor: (timingId: string) => string | null;
  proposed: LineAutomationProposedJob[];
  skipped: LineAutomationSkippedCandidate[];
}): void {
  for (const timingId of input.timings) {
    const fireAt = input.fireAtFor(timingId);
    if (!fireAt) {
      input.skipped.push(
        skip(input.organizationId, input.automationType, "skipped_missing_data", "無法計算發送時間，略過排程", {
          eventId: input.eventId,
          customerId: input.customerId,
          timingId,
        }),
      );
      continue;
    }
    if (Date.parse(fireAt) <= input.nowMs) {
      input.skipped.push(
        skip(input.organizationId, input.automationType, "skipped_past", "發送時間已過", {
          eventId: input.eventId,
          customerId: input.customerId,
          timingId,
        }),
      );
      continue;
    }
    input.proposed.push(
      propose({
        organizationId: input.organizationId,
        automationType: input.automationType,
        eventKind: input.eventKind,
        eventId: input.eventId,
        customerId: input.customerId,
        timingId,
        fireAt,
        template: input.template,
        recipientReady: input.recipientReady,
      }),
    );
  }
}

export function scheduleTimezone(): string {
  return LINE_AUTOMATION_SCHEDULE_TIMEZONE;
}

export function isLineAutomationScheduleType(value: string): value is LineAutomationId {
  return isLineAutomationId(value);
}
