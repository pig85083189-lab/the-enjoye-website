/**
 * Phase 1C-6G authenticated Treatment write foundation.
 *
 * Client / test import only. Server Components must use
 * treatment-remote-write-flag.ts so the adapter graph stays out of RSC.
 *
 * Does not enable BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Live Treatment create / autosave / complete use this factory when the
 * Treatment remote-write pilot is on. No service role.
 * No local + remote dual write.
 */

import type { TreatmentDraft } from "@/types/treatment";
import {
  canWriteTreatment,
  type CapabilityActor,
} from "@/lib/staff-auth/operational-capabilities";
import { TreatmentRemoteAdapter } from "@/lib/persistence/treatment-remote-adapter";
import {
  AuthenticatedTreatmentTableStore,
  type AuthenticatedTreatmentSupabaseClient,
} from "@/lib/persistence/authenticated-treatment-store";
import { AuthenticatedAppointmentReadStore } from "@/lib/persistence/authenticated-appointment-read-store";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
  type LoadedAuthenticatedIdentity,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  TreatmentWriteNotFoundError,
  TreatmentWriteStaleError,
  TreatmentWriteZeroRowError,
} from "./treatment-write-errors";
import { isTreatmentRemoteWritePilotEnabled } from "./treatment-remote-write-flag";

export {
  TREATMENT_REMOTE_WRITE_PILOT_ENV,
  isTreatmentRemoteWritePilotEnabled,
} from "./treatment-remote-write-flag";

export {
  TreatmentAppointmentImmutableError,
  TreatmentCompletedImmutableError,
  TreatmentCustomerImmutableError,
  TreatmentDuplicateError,
  TreatmentLocationImmutableError,
  TreatmentWriteNotFoundError,
  TreatmentWriteStaleError,
  TreatmentWriteZeroRowError,
} from "./treatment-write-errors";

export const TREATMENT_WRITE_PILOT_DENIED_MESSAGE =
  "Treatment remote write is not allowed for this role";

export class TreatmentWritePilotDeniedError extends Error {
  constructor(message = TREATMENT_WRITE_PILOT_DENIED_MESSAGE) {
    super(message);
    this.name = "TreatmentWritePilotDeniedError";
  }
}

export type TreatmentWriteClient = IdentitySupabaseClient &
  AuthenticatedTreatmentSupabaseClient;

export interface AuthenticatedTreatmentWritePersistence {
  identity: LoadedAuthenticatedIdentity;
  treatments: TreatmentRemoteAdapter;
}

export function assertTreatmentWriteRole(actor: CapabilityActor): void {
  if (!canWriteTreatment(actor)) {
    throw new TreatmentWritePilotDeniedError();
  }
}

export async function createAuthenticatedTreatmentWritePersistence(
  client: TreatmentWriteClient,
  organizationAppId?: string | null,
): Promise<AuthenticatedTreatmentWritePersistence> {
  const identity = await loadAuthenticatedIdentityCatalog(client, organizationAppId);
  return {
    identity,
    treatments: new TreatmentRemoteAdapter(
      identity.mapper,
      new AuthenticatedTreatmentTableStore(client),
      new AuthenticatedAppointmentReadStore(client),
    ),
  };
}

function actorFromIdentity(identity: LoadedAuthenticatedIdentity): CapabilityActor {
  const staff = identity.catalog.findStaffByAppId(
    identity.organizationDbId,
    identity.operationalStaffId,
  );
  return { role: staff?.role, isActive: true };
}

export async function runAuthenticatedTreatmentCreate(
  client: TreatmentWriteClient,
  input: {
    locationId: string;
    customerId: string;
    serviceId: string;
    staffId: string;
    appointmentId?: string;
    id?: string;
    draft?: Partial<TreatmentDraft>;
    templateType?: string;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft> {
  if (!isTreatmentRemoteWritePilotEnabled(env)) {
    throw new Error("Treatment remote write pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentWritePersistence(client);
  assertTreatmentWriteRole(actorFromIdentity(persistence.identity));
  return persistence.treatments.create(persistence.identity.organizationAppId, {
    ...input,
    createdBy: persistence.identity.operationalStaffId,
  });
}

export async function runAuthenticatedTreatmentAutosave(
  client: TreatmentWriteClient,
  input: {
    treatmentId: string;
    expectedUpdatedAt: string;
    locationId: string;
    customerId: string;
    serviceId: string;
    staffId: string;
    appointmentId?: string;
    draft: TreatmentDraft;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft> {
  if (!isTreatmentRemoteWritePilotEnabled(env)) {
    throw new Error("Treatment remote write pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentWritePersistence(client);
  assertTreatmentWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.treatments.update(persistence.identity.organizationAppId, {
      ...input,
      updatedBy: persistence.identity.operationalStaffId,
    });
  } catch (error) {
    if (error instanceof TreatmentWriteZeroRowError) {
      throw new TreatmentWriteStaleError();
    }
    throw error;
  }
}

export async function runAuthenticatedTreatmentComplete(
  client: TreatmentWriteClient,
  input: {
    treatmentId: string;
    expectedUpdatedAt: string;
    locationId: string;
    customerId: string;
    serviceId: string;
    staffId: string;
    appointmentId?: string;
    draft: TreatmentDraft;
  },
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): Promise<TreatmentDraft> {
  if (!isTreatmentRemoteWritePilotEnabled(env)) {
    throw new Error("Treatment remote write pilot is off");
  }
  const persistence = await createAuthenticatedTreatmentWritePersistence(client);
  assertTreatmentWriteRole(actorFromIdentity(persistence.identity));
  try {
    return await persistence.treatments.complete(persistence.identity.organizationAppId, {
      ...input,
      updatedBy: persistence.identity.operationalStaffId,
    });
  } catch (error) {
    if (error instanceof TreatmentWriteZeroRowError) {
      const existing = await persistence.treatments.get(
        persistence.identity.organizationAppId,
        input.treatmentId,
      );
      if (!existing) throw new TreatmentWriteNotFoundError();
      if (existing.status === "completed" && existing.updatedAt !== input.expectedUpdatedAt) {
        return existing;
      }
      throw new TreatmentWriteStaleError();
    }
    throw error;
  }
}
