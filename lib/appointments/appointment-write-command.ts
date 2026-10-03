/**
 * Prepare a create-only remote Appointment command.
 * Generates the domain app id once, forces BOOKED, and derives snapshots.
 */

import { newId } from "@/lib/repositories/storage";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import { assertMappedAppointmentDependencies } from "@/lib/persistence/appointment-mapping";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { appointmentWriteRangeFromTaipei } from "./appointment-write-time";
import {
  deriveAppointmentWriteSnapshots,
  type AppointmentWriteSnapshotCatalog,
} from "./appointment-write-snapshots";

export interface AppointmentWriteDraftInput {
  organizationId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  createdBy?: string;
  dateYmd: string;
  startHm: string;
  durationMinutes: number;
  customerNote?: string;
  internalNote?: string;
  /** Ignored. Snapshots come from the authenticated catalog. */
  customerName?: string;
  /** Ignored. Snapshots come from the authenticated catalog. */
  serviceName?: string;
  /** Ignored. Snapshots come from the authenticated catalog. */
  staffName?: string;
  /** Ignored. Create is always BOOKED. */
  status?: string;
  /** Optional pre-generated apt-* id. Generated once when omitted. */
  appointmentId?: string;
}

export interface PreparedAppointmentCreate {
  organizationId: string;
  appointmentId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  createdBy: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: "BOOKED";
  customerName: string;
  serviceName: string;
  staffName: string;
  customerNote?: string;
  internalNote?: string;
}

export function allocateAppointmentWriteAppId(
  generate: () => string = () => newId("apt"),
): string {
  const appointmentId = generate();
  if (!isGeneratedAppointmentAppId(appointmentId)) {
    throw new Error('Appointment app id must be generated via newId("apt")');
  }
  return appointmentId;
}

export function prepareAppointmentCreateCommand(
  input: AppointmentWriteDraftInput,
  deps: {
    mapper: CanonicalIdMapper;
    snapshots: AppointmentWriteSnapshotCatalog;
    generateId?: () => string;
  },
): PreparedAppointmentCreate {
  const appointmentId = input.appointmentId
    ? allocateAppointmentWriteAppId(() => input.appointmentId!)
    : allocateAppointmentWriteAppId(deps.generateId);
  const mapped = assertMappedAppointmentDependencies(
    deps.mapper,
    input.organizationId,
    input,
  );
  void mapped;
  const staffId = deps.mapper.requireOperationalStaffId(
    input.organizationId,
    input.staffId,
  );
  if (!input.createdBy?.trim()) {
    throw new Error("Appointment create requires authenticated createdBy");
  }
  const createdBy = deps.mapper.requireOperationalStaffId(
    input.organizationId,
    input.createdBy,
  );
  const range = appointmentWriteRangeFromTaipei(
    input.dateYmd,
    input.startHm,
    input.durationMinutes,
  );
  const snapshots = deriveAppointmentWriteSnapshots(
    deps.snapshots,
    input.organizationId,
    input,
  );
  return {
    organizationId: input.organizationId,
    appointmentId,
    locationId: input.locationId,
    customerId: input.customerId,
    serviceId: input.serviceId,
    staffId,
    createdBy,
    startAt: range.startsAt,
    endAt: range.endsAt,
    durationMinutes: range.durationMinutes,
    status: "BOOKED",
    customerName: snapshots.customerName,
    serviceName: snapshots.serviceName,
    staffName: snapshots.staffName,
    customerNote: input.customerNote,
    internalNote: input.internalNote,
  };
}
