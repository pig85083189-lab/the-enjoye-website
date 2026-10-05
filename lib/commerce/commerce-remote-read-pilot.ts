/**
 * Phase 1C-6H.1 authenticated Commerce identity read foundation.
 *
 * Client / test import only. Server Components must use
 * commerce-remote-read-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Composes existing authenticated Customer / Appointment / Treatment /
 * Service read stores. No CheckoutDraft persist. No settle. No service role.
 * No localStorage fallback.
 */

import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import { AuthenticatedAppointmentReadStore } from "@/lib/persistence/authenticated-appointment-read-store";
import { AuthenticatedCustomerReadStore } from "@/lib/persistence/authenticated-customer-read-store";
import {
  AuthenticatedServiceTableStore,
  type AuthenticatedServiceSupabaseClient,
} from "@/lib/persistence/authenticated-service-store";
import { AuthenticatedTreatmentReadStore } from "@/lib/persistence/authenticated-treatment-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import { ServiceRemoteAdapter } from "@/lib/persistence/service-remote-adapter";
import { TreatmentRemoteAdapter } from "@/lib/persistence/treatment-remote-adapter";
import type { CapabilityActor } from "@/lib/staff-auth/operational-capabilities";
import {
  assertCommerceCheckoutReadRole,
  buildCommerceCheckoutCandidate,
  type CommerceCheckoutCandidate,
} from "./commerce-remote-identity";
import {
  isCommerceRemoteReadPilotEnabled,
} from "./commerce-remote-read-flag";

export {
  COMMERCE_REMOTE_READ_PILOT_ENV,
  isCommerceRemoteReadPilotEnabled,
} from "./commerce-remote-read-flag";

export const COMMERCE_REMOTE_READ_PILOT_OFF_MESSAGE =
  "Commerce remote read pilot is off";

const COMMERCE_SERVICE_READ_ONLY_MESSAGE =
  "Commerce remote identity path does not write services";

function asServiceReadClient(
  client: IdentitySupabaseClient,
): AuthenticatedServiceSupabaseClient {
  return {
    from(table: string) {
      const query = client.from(table);
      return {
        select: (columns: string) => query.select(columns),
        insert() {
          throw new Error(COMMERCE_SERVICE_READ_ONLY_MESSAGE);
        },
        update() {
          throw new Error(COMMERCE_SERVICE_READ_ONLY_MESSAGE);
        },
      };
    },
  } as unknown as AuthenticatedServiceSupabaseClient;
}

export async function createAuthenticatedCommerceReadPersistence(
  client: IdentitySupabaseClient,
) {
  const identity = await loadAuthenticatedIdentityCatalog(client);
  const appointments = new AuthenticatedAppointmentReadStore(client);
  return {
    identity,
    customers: new CustomerRemoteAdapter(
      identity.mapper,
      new AuthenticatedCustomerReadStore(client),
    ),
    appointments: new AppointmentRemoteAdapter(identity.mapper, appointments),
    treatments: new TreatmentRemoteAdapter(
      identity.mapper,
      new AuthenticatedTreatmentReadStore(client),
      appointments,
    ),
    services: new ServiceRemoteAdapter(
      identity.mapper,
      new AuthenticatedServiceTableStore(asServiceReadClient(client)),
    ),
  };
}

function requirePilot(env: NodeJS.Dict<string>): void {
  if (!isCommerceRemoteReadPilotEnabled(env)) {
    throw new Error(COMMERCE_REMOTE_READ_PILOT_OFF_MESSAGE);
  }
}

export async function listRemoteCommerceCheckoutCandidates(
  organizationId: string,
  input: {
    locationId?: string;
    actor: CapabilityActor;
  },
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<CommerceCheckoutCandidate[]> {
  requirePilot(env);
  assertCommerceCheckoutReadRole(input.actor);
  const persistence = await createAuthenticatedCommerceReadPersistence(client);
  persistence.identity.mapper.resolveOrganizationDbId(organizationId);

  const [appointments, treatments, customers, services] = await Promise.all([
    persistence.appointments.list({
      organizationId,
      locationId: input.locationId,
    }),
    persistence.treatments.list(organizationId),
    persistence.customers.list({ organizationId }),
    persistence.services.list(organizationId),
  ]);

  const appointmentById = new Map(appointments.map((item) => [item.id, item]));
  const customerById = new Map(customers.map((item) => [item.id, item]));
  const serviceById = new Map(services.map((item) => [item.id, item]));
  const candidates: CommerceCheckoutCandidate[] = [];

  for (const treatment of treatments) {
    if (!treatment.appointmentId) continue;
    const appointment = appointmentById.get(treatment.appointmentId);
    if (!appointment) continue;
    const candidate = buildCommerceCheckoutCandidate({
      organizationId,
      appointment,
      treatment,
      customer: customerById.get(appointment.customerId),
      service: serviceById.get(appointment.serviceId),
    });
    if (candidate) candidates.push(candidate);
  }

  return candidates.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export async function getRemoteCommerceCheckoutCandidate(
  organizationId: string,
  appointmentId: string,
  input: {
    actor: CapabilityActor;
    treatmentId?: string;
  },
  client: IdentitySupabaseClient,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<CommerceCheckoutCandidate | undefined> {
  requirePilot(env);
  assertCommerceCheckoutReadRole(input.actor);
  const persistence = await createAuthenticatedCommerceReadPersistence(client);
  persistence.identity.mapper.resolveOrganizationDbId(organizationId);

  const appointment = await persistence.appointments.get(organizationId, appointmentId);
  if (!appointment || appointment.organizationId !== organizationId) {
    return undefined;
  }

  const treatment = input.treatmentId
    ? await persistence.treatments.get(organizationId, input.treatmentId)
    : await persistence.treatments.getByAppointmentId(organizationId, appointmentId);
  if (!treatment) return undefined;

  const [customer, service] = await Promise.all([
    persistence.customers.getById({
      organizationId,
      id: appointment.customerId,
    }),
    persistence.services.getById(organizationId, appointment.serviceId),
  ]);

  return (
    buildCommerceCheckoutCandidate({
      organizationId,
      appointment,
      treatment,
      customer,
      service,
    }) ?? undefined
  );
}
