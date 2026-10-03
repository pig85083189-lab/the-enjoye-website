/**
 * Canonical snapshot source for a future remote Appointment create.
 * UI names are never authoritative.
 */

export const APPOINTMENT_WRITE_SNAPSHOT_UNMAPPED_MESSAGE =
  "Appointment write snapshot dependency is unmapped";

export interface AppointmentWriteNamedRecord {
  organizationId: string;
  appId: string;
  name: string;
}

export interface AppointmentWriteSnapshotCatalog {
  customerName(organizationId: string, customerAppId: string): string;
  serviceName(organizationId: string, serviceAppId: string): string;
  staffName(organizationId: string, staffAppId: string): string;
}

function requireName(
  rows: AppointmentWriteNamedRecord[],
  organizationId: string,
  appId: string,
  kind: string,
): string {
  const match = rows.filter(
    (row) => row.organizationId === organizationId && row.appId === appId,
  );
  if (match.length !== 1) {
    throw new Error(`${APPOINTMENT_WRITE_SNAPSHOT_UNMAPPED_MESSAGE}: ${kind}`);
  }
  const name = match[0]!.name.trim();
  if (!name) {
    throw new Error(`${APPOINTMENT_WRITE_SNAPSHOT_UNMAPPED_MESSAGE}: ${kind} name`);
  }
  return name;
}

export function createAppointmentWriteSnapshotCatalog(records: {
  customers: AppointmentWriteNamedRecord[];
  services: AppointmentWriteNamedRecord[];
  staff: AppointmentWriteNamedRecord[];
}): AppointmentWriteSnapshotCatalog {
  return {
    customerName(organizationId, customerAppId) {
      return requireName(records.customers, organizationId, customerAppId, "customer");
    },
    serviceName(organizationId, serviceAppId) {
      return requireName(records.services, organizationId, serviceAppId, "service");
    },
    staffName(organizationId, staffAppId) {
      return requireName(records.staff, organizationId, staffAppId, "staff");
    },
  };
}

export function deriveAppointmentWriteSnapshots(
  catalog: AppointmentWriteSnapshotCatalog,
  organizationId: string,
  input: { customerId: string; serviceId: string; staffId: string },
): { customerName: string; serviceName: string; staffName: string } {
  return {
    customerName: catalog.customerName(organizationId, input.customerId),
    serviceName: catalog.serviceName(organizationId, input.serviceId),
    staffName: catalog.staffName(organizationId, input.staffId),
  };
}
