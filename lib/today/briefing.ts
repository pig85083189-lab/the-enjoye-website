/**
 * Today briefing helpers — derived from Customer + treatments; no new store.
 */
import { getServiceById } from "@/data/mock-services";
import { combineLocalDateTime, formatYmd } from "@/lib/appointments/domain";
import { getCompletedTreatmentsForCustomer } from "@/lib/treatment-draft";
import type { Appointment, Customer } from "@/types";

export type BriefingTiming =
  | { kind: "later"; label: string; minutes: number }
  | { kind: "waiting"; label: string }
  | { kind: "in_service"; label: string; elapsedMinutes: number }
  | { kind: "done"; label: string };

export const DEFAULT_BRIEFING_CHECKS = [
  "詢問上次療程後反應",
  "確認近期身體狀況",
  "了解本次想加強的部位",
] as const;

/** Parse appointment.time (HH:mm) against local calendar day of `now`. */
export function appointmentStartDate(
  appointmentTimeHm: string,
  now: Date,
): Date {
  const ymd = formatYmd(now);
  return combineLocalDateTime(ymd, appointmentTimeHm);
}

export function resolveBriefingTiming(
  appointment: Appointment,
  now: Date,
): BriefingTiming {
  if (appointment.status === "completed") {
    return { kind: "done", label: "本日已完成" };
  }
  if (appointment.status === "in_progress") {
    const start = appointmentStartDate(appointment.time, now);
    const elapsed = Math.max(
      0,
      Math.floor((now.getTime() - start.getTime()) / 60_000),
    );
    return {
      kind: "in_service",
      label: `服務進行中 · ${elapsed} 分鐘`,
      elapsedMinutes: elapsed,
    };
  }
  const start = appointmentStartDate(appointment.time, now);
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes > 0) {
    return { kind: "later", label: `${minutes} 分鐘後`, minutes };
  }
  return { kind: "waiting", label: "等待開始" };
}

/**
 * 「需要留意」— merge real Customer / treatment fields; dedupe; cap length.
 */
export function collectAttentionNotes(
  organizationId: string,
  customer: Customer | undefined,
  appointment: Appointment,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function push(raw: string | undefined | null) {
    const text = raw?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  }

  for (const note of appointment.notes ?? []) push(note);

  if (customer) {
    for (const alert of customer.alerts ?? []) {
      push(alert.value || alert.label);
    }
    for (const note of customer.importantNotes ?? []) push(note);
    for (const note of customer.lastServiceNotes ?? []) push(note);
    for (const focus of customer.trackingFocus ?? []) push(focus);
  }

  const treatments = getCompletedTreatmentsForCustomer(
    organizationId,
    appointment.customerId,
  );
  const latest = treatments[0];
  if (latest) {
    push(latest.professionalNote);
    push(latest.followUp.note);
    for (const tag of latest.followUp.tags) push(tag);
    if (latest.discomfortNote) push(latest.discomfortNote);
  }

  return out.slice(0, 6);
}

export function lastServiceSummary(
  organizationId: string,
  customer: Customer | undefined,
): { dateLabel: string; serviceName?: string } | null {
  if (!customer) return null;
  const treatments = getCompletedTreatmentsForCustomer(
    organizationId,
    customer.id,
  );
  const latest = treatments[0];
  if (latest) {
    let dateLabel = customer.lastVisit;
    try {
      dateLabel = formatYmd(new Date(latest.updatedAt)).replace(/-/g, "/");
    } catch {
      /* keep lastVisit */
    }
    const fromCatalog = getServiceById(latest.serviceId, organizationId)?.name;
    return {
      dateLabel: dateLabel || customer.lastVisit,
      serviceName: fromCatalog ?? customer.lastServiceName,
    };
  }
  if (!customer.lastVisit) return null;
  return {
    dateLabel: customer.lastVisit,
    serviceName: customer.lastServiceName,
  };
}
