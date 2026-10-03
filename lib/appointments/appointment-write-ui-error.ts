/**
 * User-safe Calendar messages for the Appointment remote create pilot.
 * Never forwards raw PostgreSQL / PostgREST text to the UI.
 */

import { IdentityCatalogError, UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  isAppointmentExclusionConflictError,
} from "./appointment-write-create";
import {
  AppointmentWriteCreateOnlyError,
  AppointmentWritePilotDeniedError,
} from "./appointment-write-guard";
import { APPOINTMENT_WRITE_SNAPSHOT_UNMAPPED_MESSAGE } from "./appointment-write-snapshots";

export const APPOINTMENT_WRITE_UI = {
  conflict: "此時段美容師已有預約，無法重複建立",
  mapping: "預約資料無法對應，未建立",
  snapshot: "無法取得顧客、服務或美容師名稱，未建立",
  unauthenticated: "尚未登入，無法建立遠端預約",
  denied: "僅店主可建立遠端預約",
  network: "連線失敗，預約尚未確認",
  retryable: "建立結果未確認，請用同一筆再試一次",
  integrity: "預約資料不一致，請勿重送",
  createOnly: "目前僅能新增預約",
  generic: "無法建立預約",
} as const;

function looksLikeDatabaseText(message: string): boolean {
  return (
    /23P01|23505|exclusion constraint|duplicate key|unique constraint|violates|SQLSTATE|postgres/i.test(
      message,
    ) || message.includes("appointments_staff_active_no_overlap")
  );
}

export function appointmentWriteUserMessage(error: unknown): string {
  if (error instanceof AppointmentConflictError || isAppointmentExclusionConflictError(error)) {
    return APPOINTMENT_WRITE_UI.conflict;
  }
  if (error instanceof AppointmentWriteRetryableError) {
    return APPOINTMENT_WRITE_UI.retryable;
  }
  if (error instanceof AppointmentWriteIntegrityError) {
    return APPOINTMENT_WRITE_UI.integrity;
  }
  if (error instanceof AppointmentWritePilotDeniedError) {
    return APPOINTMENT_WRITE_UI.denied;
  }
  if (error instanceof AppointmentWriteCreateOnlyError) {
    return APPOINTMENT_WRITE_UI.createOnly;
  }
  if (error instanceof UnmappedIdentityError) {
    return APPOINTMENT_WRITE_UI.mapping;
  }
  if (error instanceof IdentityCatalogError) {
    if (error.reason === "unauthenticated") return APPOINTMENT_WRITE_UI.unauthenticated;
    return APPOINTMENT_WRITE_UI.mapping;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(APPOINTMENT_WRITE_SNAPSHOT_UNMAPPED_MESSAGE)) {
    return APPOINTMENT_WRITE_UI.snapshot;
  }
  if (/unmapped|fail-closed|cannot be resolved/i.test(message)) {
    return APPOINTMENT_WRITE_UI.mapping;
  }
  if (/timeout|network|fetch|abort|Failed to fetch|empty response/i.test(message)) {
    return APPOINTMENT_WRITE_UI.network;
  }
  if (looksLikeDatabaseText(message)) {
    return APPOINTMENT_WRITE_UI.generic;
  }
  return APPOINTMENT_WRITE_UI.generic;
}
