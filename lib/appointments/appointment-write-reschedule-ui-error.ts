/**
 * User-safe Calendar messages for remote Appointment reschedule.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  isAppointmentExclusionConflictError,
} from "./appointment-write-create";
import { AppointmentWritePilotDeniedError } from "./appointment-write-guard";
import {
  AppointmentCustomerImmutableError,
  AppointmentWriteNotFoundError,
  AppointmentWriteStaleError,
} from "./appointment-write-mutate-errors";

export const APPOINTMENT_RESCHEDULE_UI = {
  stale: "預約已被更新，請重新確認後再改期",
  denied: "沒有權限改期遠端預約",
  unauthenticated: "尚未登入，無法改期遠端預約",
  mapping: "預約資料無法對應，未改期",
  network: "連線失敗，預約尚未改期",
  retryable: "改期結果未確認，請再試一次",
  integrity: "預約資料不一致，請勿重送",
  notFound: "找不到這筆預約，無法改期",
  conflict: "此時段美容師已有預約，無法改期",
  customer: "遠端改期不能更換顧客",
  generic: "無法改期預約",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return (
    /23P01|23505|exclusion constraint|duplicate key|unique constraint|violates|SQLSTATE|postgres/i.test(
      message,
    ) || message.includes("appointments_staff_active_no_overlap")
  );
}

export function appointmentRescheduleUserMessage(error: unknown): string {
  if (error instanceof AppointmentWriteStaleError) {
    return APPOINTMENT_RESCHEDULE_UI.stale;
  }
  if (error instanceof AppointmentWriteNotFoundError) {
    return APPOINTMENT_RESCHEDULE_UI.notFound;
  }
  if (error instanceof AppointmentCustomerImmutableError) {
    return APPOINTMENT_RESCHEDULE_UI.customer;
  }
  if (error instanceof AppointmentWritePilotDeniedError) {
    return APPOINTMENT_RESCHEDULE_UI.denied;
  }
  if (error instanceof AppointmentWriteRetryableError) {
    return APPOINTMENT_RESCHEDULE_UI.retryable;
  }
  if (error instanceof AppointmentWriteIntegrityError) {
    return APPOINTMENT_RESCHEDULE_UI.integrity;
  }
  if (error instanceof AppointmentConflictError || isAppointmentExclusionConflictError(error)) {
    return APPOINTMENT_RESCHEDULE_UI.conflict;
  }
  if (error instanceof UnmappedIdentityError) {
    return APPOINTMENT_RESCHEDULE_UI.mapping;
  }
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return APPOINTMENT_RESCHEDULE_UI.unauthenticated;
    return APPOINTMENT_RESCHEDULE_UI.mapping;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/unmapped|fail-closed|cannot be resolved/i.test(message)) {
    return APPOINTMENT_RESCHEDULE_UI.mapping;
  }
  if (/timeout|network|fetch|abort|Failed to fetch|empty response/i.test(message)) {
    return APPOINTMENT_RESCHEDULE_UI.network;
  }
  if (looksLikeDatabaseText(message) || /23P01|postgres/i.test(message)) {
    return APPOINTMENT_RESCHEDULE_UI.generic;
  }
  return APPOINTMENT_RESCHEDULE_UI.generic;
}
