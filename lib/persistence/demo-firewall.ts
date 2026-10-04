/**
 * Demo seed vs remote operational writes.
 * BEAUTY_OS_DEMO_SEED=1 allows local mock/seed. Remote adapters must never
 * promote remainingSessions / mock appointments / seed visit caches into ledgers
 * or remote customer / appointment rows.
 */

import { SEED_CUSTOMERS } from "@/data/seed-crm";
import { SEED_LUMIERE_CUSTOMERS, SEED_LUMIERE_SERVICES } from "@/data/seed-organizations";
import { mockAppointments } from "@/data/mock-appointments";
import { mockServices } from "@/data/service-seed";
import { SEED_COMPLETED_TREATMENTS } from "@/lib/repositories/local-treatment-repository";

export const DEMO_SEED_FLAG = "BEAUTY_OS_DEMO_SEED";

export function isDemoSeedEnabled(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env[DEMO_SEED_FLAG] === "1";
}

export const REMOTE_DEMO_PROMOTION_MESSAGE =
  "Demo residue cannot be written to remote ledgers (Customer.packages[].remainingSessions, mock appointments, seed treatments, lastVisit, totalVisits)";

export const REMOTE_DEMO_CUSTOMER_MESSAGE =
  "Demo / seed customers cannot be written to remote customer persistence";

export const REMOTE_DEMO_APPOINTMENT_MESSAGE =
  "Demo / seed appointments cannot be written to remote appointment persistence";

export const REMOTE_DEMO_SERVICE_MESSAGE =
  "Demo / seed services cannot be written to remote service persistence";

export const REMOTE_DEMO_TREATMENT_MESSAGE =
  "Demo / seed treatments cannot be written to remote treatment persistence";

const SEED_CUSTOMER_IDS = new Set<string>([
  ...SEED_CUSTOMERS.map((c) => c.id),
  ...SEED_LUMIERE_CUSTOMERS.map((c) => c.id),
]);

const SEED_CUSTOMER_NAMES = new Set<string>([
  ...SEED_CUSTOMERS.map((c) => c.name),
  ...SEED_LUMIERE_CUSTOMERS.map((c) => c.name),
]);

const SEED_APPOINTMENT_IDS = new Set<string>([
  ...mockAppointments.map((item) => item.id),
  "lumiere-apt-001",
  "lumiere-apt-002",
]);

const SEED_SERVICE_IDS = new Set<string>([
  ...mockServices.map((item) => item.id),
  ...SEED_LUMIERE_SERVICES.map((item) => item.id),
]);

const SEED_SERVICE_NAMES = new Set<string>([
  ...mockServices.map((item) => item.name),
  ...SEED_LUMIERE_SERVICES.map((item) => item.name),
]);

const SEED_TREATMENT_IDS = new Set<string>(
  SEED_COMPLETED_TREATMENTS.map((item) => item.id),
);

export function isDemoCustomerId(id: string): boolean {
  return (
    id.startsWith("demo-") ||
    id.startsWith("lumiere-c-") ||
    id.startsWith("mock-") ||
    SEED_CUSTOMER_IDS.has(id)
  );
}

export function isDemoCustomerName(name: string | undefined): boolean {
  if (!name) return false;
  return SEED_CUSTOMER_NAMES.has(name);
}

export function isDemoAppointmentId(id: string): boolean {
  return (
    SEED_APPOINTMENT_IDS.has(id) ||
    id.startsWith("lumiere-apt-") ||
    id.startsWith("apt-00") ||
    id.startsWith("mock-")
  );
}

export function isDemoServiceId(id: string): boolean {
  return (
    SEED_SERVICE_IDS.has(id) ||
    id.startsWith("svc-breast") ||
    id.startsWith("svc-facial") ||
    id.startsWith("svc-curve") ||
    id.startsWith("svc-womb") ||
    id.startsWith("svc-lumiere-") ||
    id.startsWith("mock-")
  );
}

export function isDemoServiceName(name: string | undefined): boolean {
  if (!name) return false;
  return SEED_SERVICE_NAMES.has(name.trim());
}

export function assertNotDemoResiduePayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const row = payload as Record<string, unknown>;
  if ("remainingSessions" in row) {
    throw new Error(REMOTE_DEMO_PROMOTION_MESSAGE);
  }
  if ("lastVisit" in row || "totalVisits" in row) {
    throw new Error(REMOTE_DEMO_PROMOTION_MESSAGE);
  }
}

export function assertRemoteCustomerAllowed(customer: {
  id: string;
  name?: string;
}): void {
  if (isDemoCustomerId(customer.id) || isDemoCustomerName(customer.name)) {
    throw new Error(REMOTE_DEMO_CUSTOMER_MESSAGE);
  }
}

export function assertRemoteAppointmentAllowed(appointment: {
  id: string;
  customerId: string;
  customerName?: string;
}): void {
  if (isDemoAppointmentId(appointment.id)) {
    throw new Error(REMOTE_DEMO_APPOINTMENT_MESSAGE);
  }
  if (isDemoCustomerId(appointment.customerId) || isDemoCustomerName(appointment.customerName)) {
    throw new Error(REMOTE_DEMO_APPOINTMENT_MESSAGE);
  }
}

export function assertRemoteServiceAllowed(service: { id: string; name?: string }): void {
  if (isDemoServiceId(service.id) || isDemoServiceName(service.name)) {
    throw new Error(REMOTE_DEMO_SERVICE_MESSAGE);
  }
}

export function isGeneratedCustomerAppId(id: string): boolean {
  return /^cust-[a-z0-9]+-[a-z0-9]+$/i.test(id);
}

export function isGeneratedServiceAppId(id: string): boolean {
  return /^svc-[a-z0-9]+-[a-z0-9]+$/i.test(id) && !isDemoServiceId(id);
}

export function isGeneratedAppointmentAppId(id: string): boolean {
  return /^apt-[a-z0-9]+-[a-z0-9]+$/i.test(id) && !isDemoAppointmentId(id);
}

export function isDemoTreatmentId(id: string): boolean {
  if (SEED_TREATMENT_IDS.has(id) || id.startsWith("treatment-seed-") || id.startsWith("mock-")) {
    return true;
  }
  if (id.startsWith("treatment-")) {
    return isDemoAppointmentId(id.slice("treatment-".length));
  }
  return false;
}

export function isGeneratedTreatmentAppId(id: string): boolean {
  return /^trt-[a-z0-9]+-[a-z0-9]+$/i.test(id) && !isDemoTreatmentId(id);
}

export function assertRemoteTreatmentAllowed(treatment: {
  id: string;
  customerId: string;
  appointmentId?: string;
}): void {
  if (isDemoTreatmentId(treatment.id) || !isGeneratedTreatmentAppId(treatment.id)) {
    throw new Error(REMOTE_DEMO_TREATMENT_MESSAGE);
  }
  if (isDemoCustomerId(treatment.customerId)) {
    throw new Error(REMOTE_DEMO_TREATMENT_MESSAGE);
  }
  if (treatment.appointmentId && isDemoAppointmentId(treatment.appointmentId)) {
    throw new Error(REMOTE_DEMO_TREATMENT_MESSAGE);
  }
}

/** Always fail closed — seed remaining must never become a PURCHASE ledger. */
export function promoteDemoRemainingSessionsToRemote(): never {
  throw new Error(REMOTE_DEMO_PROMOTION_MESSAGE);
}
