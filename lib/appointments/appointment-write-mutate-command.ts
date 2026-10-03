/**
 * Typed cancel / reschedule / transition commands for a future remote mutate pilot.
 * Validates existing domain rules. Does not connect to UI.
 */

import {
  assertTransition,
  durationBetween,
  type CanonicalAppointmentStatus,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import { assertMappedAppointmentDependencies } from "@/lib/persistence/appointment-mapping";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { appointmentWriteRangeFromTaipei } from "./appointment-write-time";
import {
  deriveAppointmentWriteSnapshots,
  type AppointmentWriteSnapshotCatalog,
} from "./appointment-write-snapshots";
import {
  APPOINTMENT_ALLOW_CONFLICT_REFUSED_MESSAGE,
  APPOINTMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE,
  AppointmentCustomerImmutableError,
} from "./appointment-write-mutate-errors";

export type AppointmentMutateKind = "cancel" | "reschedule" | "transition";

type MutateDraftBase = {
  appointmentId: string;
  expectedUpdatedAt: string;
  organizationId?: string;
  customerId?: string;
  dbId?: string;
  allowConflict?: boolean;
};

export type AppointmentCancelDraft = MutateDraftBase & {
  kind: "cancel";
  status?: "CANCELLED" | "NO_SHOW";
  statusReason?: string;
};

export type AppointmentRescheduleDraft = MutateDraftBase & {
  kind: "reschedule";
  dateYmd: string;
  startHm: string;
  durationMinutes: number;
  staffId?: string;
  locationId?: string;
  serviceId?: string;
  customerNote?: string;
  internalNote?: string;
};

export type AppointmentTransitionDraft = MutateDraftBase & {
  kind: "transition";
  status: CanonicalAppointmentStatus;
  statusReason?: string;
};

export type AppointmentMutateDraft =
  | AppointmentCancelDraft
  | AppointmentRescheduleDraft
  | AppointmentTransitionDraft;

export interface PreparedAppointmentMutate {
  kind: AppointmentMutateKind;
  organizationId: string;
  appointmentId: string;
  expectedUpdatedAt: string;
  dbId?: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  updatedBy: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: CanonicalAppointmentStatus;
  customerName: string;
  serviceName: string;
  staffName: string;
  customerNote?: string;
  internalNote?: string;
  statusReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  locationChanged: boolean;
}

function requireExpectedUpdatedAt(value: string | undefined): string {
  const expectedUpdatedAt = value?.trim() ?? "";
  if (!expectedUpdatedAt) {
    throw new Error(APPOINTMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE);
  }
  return expectedUpdatedAt;
}

function refuseAllowConflict(input: AppointmentMutateDraft): void {
  if (input.allowConflict) {
    throw new Error(APPOINTMENT_ALLOW_CONFLICT_REFUSED_MESSAGE);
  }
}

function assertCustomerImmutable(
  current: ScheduleAppointment,
  requestedCustomerId: string | undefined,
): void {
  if (requestedCustomerId && requestedCustomerId !== current.customerId) {
    throw new AppointmentCustomerImmutableError();
  }
}

function cancelledMetadata(
  current: ScheduleAppointment,
  nextStatus: CanonicalAppointmentStatus,
  updatedBy: string,
  now: () => string,
): Pick<PreparedAppointmentMutate, "cancelledAt" | "cancelledBy"> {
  if (nextStatus === "CANCELLED" || nextStatus === "NO_SHOW") {
    return {
      cancelledAt: current.cancelledAt ?? now(),
      cancelledBy: current.cancelledBy ?? updatedBy,
    };
  }
  return {
    cancelledAt: current.cancelledAt,
    cancelledBy: current.cancelledBy,
  };
}

export function prepareAppointmentMutateCommand(
  input: AppointmentMutateDraft,
  current: ScheduleAppointment,
  deps: {
    mapper: CanonicalIdMapper;
    snapshots: AppointmentWriteSnapshotCatalog;
    organizationId: string;
    updatedBy: string;
    now?: () => string;
  },
): PreparedAppointmentMutate {
  refuseAllowConflict(input);
  const expectedUpdatedAt = requireExpectedUpdatedAt(input.expectedUpdatedAt);
  if (input.appointmentId !== current.id) {
    throw new Error("Appointment mutate command app_id does not match the loaded row");
  }
  if (input.organizationId && input.organizationId !== deps.organizationId) {
    throw new Error("Appointment mutate organization does not match the authenticated organization");
  }
  if (current.organizationId !== deps.organizationId) {
    throw new Error("Appointment mutate organization does not match the authenticated organization");
  }
  assertCustomerImmutable(current, input.customerId);

  const updatedBy = deps.mapper.requireOperationalStaffId(deps.organizationId, deps.updatedBy);
  const now = deps.now ?? (() => new Date().toISOString());

  let locationId = current.locationId;
  let serviceId = current.serviceId;
  let staffId = current.staffId;
  let startAt = current.startAt;
  let endAt = current.endAt;
  let status = current.status;
  let customerNote = current.customerNote;
  let internalNote = current.internalNote;
  let statusReason = current.statusReason;
  const kind: AppointmentMutateKind = input.kind;

  if (input.kind === "cancel") {
    status = input.status ?? "CANCELLED";
    assertTransition(current.status, status);
    statusReason = input.statusReason ?? current.statusReason;
  } else if (input.kind === "transition") {
    status = input.status;
    assertTransition(current.status, status);
    statusReason = input.statusReason ?? current.statusReason;
  } else {
    const range = appointmentWriteRangeFromTaipei(
      input.dateYmd,
      input.startHm,
      input.durationMinutes,
    );
    startAt = range.startsAt;
    endAt = range.endsAt;
    locationId = input.locationId ?? current.locationId;
    serviceId = input.serviceId ?? current.serviceId;
    staffId = input.staffId ?? current.staffId;
    if (input.customerNote !== undefined) customerNote = input.customerNote;
    if (input.internalNote !== undefined) internalNote = input.internalNote;
  }

  const mapped = assertMappedAppointmentDependencies(deps.mapper, deps.organizationId, {
    locationId,
    customerId: current.customerId,
    serviceId,
  });
  void mapped;
  staffId = deps.mapper.requireOperationalStaffId(deps.organizationId, staffId);

  const snapshots = deriveAppointmentWriteSnapshots(deps.snapshots, deps.organizationId, {
    customerId: current.customerId,
    serviceId,
    staffId,
  });
  const cancelled = cancelledMetadata(current, status, updatedBy, now);
  const durationMinutes = durationBetween(startAt, endAt);

  return {
    kind,
    organizationId: deps.organizationId,
    appointmentId: current.id,
    expectedUpdatedAt,
    dbId: input.dbId,
    locationId,
    customerId: current.customerId,
    serviceId,
    staffId,
    updatedBy,
    startAt,
    endAt,
    durationMinutes,
    status,
    customerName: snapshots.customerName,
    serviceName: snapshots.serviceName,
    staffName: snapshots.staffName,
    customerNote,
    internalNote,
    statusReason,
    cancelledAt: cancelled.cancelledAt,
    cancelledBy: cancelled.cancelledBy,
    locationChanged: locationId !== current.locationId,
  };
}
