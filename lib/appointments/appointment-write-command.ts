/**
 * Prepare a create-only remote Appointment command.
 * Generates the domain app id once, forces BOOKED, and derives snapshots.
 */

import { newId } from "@/lib/repositories/storage";
import { isGeneratedAppointmentAppId } from "@/lib/persistence/demo-firewall";
import {
  assertMappedAppointmentDependencies,
  assertMappedWalkInAppointmentDependencies,
} from "@/lib/persistence/appointment-mapping";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { appointmentWriteRangeFromTaipei } from "./appointment-write-time";
import {
  BOOKING_ORIGIN_CUSTOMER,
  BOOKING_ORIGIN_WALK_IN_ONCE,
  type BookingOrigin,
  validateOneTimeBooking,
} from "./one-time-booking";
import {
  deriveAppointmentWriteSnapshots,
  type AppointmentWriteSnapshotCatalog,
} from "./appointment-write-snapshots";

export interface AppointmentWriteDraftInput {
  organizationId: string;
  locationId: string;
  /** Required for CUSTOMER bookings. Must be omitted for WALK_IN_ONCE. */
  customerId?: string;
  serviceId: string;
  staffId: string;
  createdBy?: string;
  dateYmd: string;
  startHm: string;
  durationMinutes: number;
  customerNote?: string;
  internalNote?: string;
  bookingOrigin?: BookingOrigin;
  /** Authoritative guest display name for WALK_IN_ONCE only. */
  guestName?: string;
  /** Guest phone for WALK_IN_ONCE only. Never written to customers.phone. */
  guestPhone?: string;
  /** Ignored for CUSTOMER. Snapshots come from the authenticated catalog. */
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
  customerId: string | null;
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
  bookingOrigin: BookingOrigin;
  guestContactPhone: string | null;
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
  const bookingOrigin = input.bookingOrigin ?? BOOKING_ORIGIN_CUSTOMER;
  const walkInOnce = bookingOrigin === BOOKING_ORIGIN_WALK_IN_ONCE;

  if (walkInOnce) {
    if (input.customerId) {
      throw new Error("Walk-in once appointments must not include a customer id");
    }
    assertMappedWalkInAppointmentDependencies(deps.mapper, input.organizationId, input);
  } else {
    if (!input.customerId?.trim()) {
      throw new Error("Appointment create requires a mapped customer");
    }
    assertMappedAppointmentDependencies(deps.mapper, input.organizationId, {
      locationId: input.locationId,
      customerId: input.customerId,
      serviceId: input.serviceId,
    });
  }

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

  let customerName: string;
  let guestContactPhone: string | null = null;
  let serviceName: string;
  let staffName: string;

  if (walkInOnce) {
    const guestError = validateOneTimeBooking({
      guestName: input.guestName ?? "",
      guestPhone: input.guestPhone ?? "",
      serviceId: input.serviceId,
      staffId: input.staffId,
      locationId: input.locationId,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
    });
    if (guestError) throw new Error(guestError);
    customerName = input.guestName!.trim();
    guestContactPhone = input.guestPhone!.trim();
    serviceName = deps.snapshots.serviceName(input.organizationId, input.serviceId);
    staffName = deps.snapshots.staffName(input.organizationId, input.staffId);
  } else {
    const snapshots = deriveAppointmentWriteSnapshots(
      deps.snapshots,
      input.organizationId,
      {
        customerId: input.customerId!,
        serviceId: input.serviceId,
        staffId: input.staffId,
      },
    );
    customerName = snapshots.customerName;
    serviceName = snapshots.serviceName;
    staffName = snapshots.staffName;
  }

  return {
    organizationId: input.organizationId,
    appointmentId,
    locationId: input.locationId,
    customerId: walkInOnce ? null : input.customerId!,
    serviceId: input.serviceId,
    staffId,
    createdBy,
    startAt: range.startsAt,
    endAt: range.endsAt,
    durationMinutes: range.durationMinutes,
    status: "BOOKED",
    customerName,
    serviceName,
    staffName,
    customerNote: input.customerNote,
    internalNote: input.internalNote,
    bookingOrigin: walkInOnce ? BOOKING_ORIGIN_WALK_IN_ONCE : BOOKING_ORIGIN_CUSTOMER,
    guestContactPhone,
  };
}
