/**
 * Explicit remote persistence factory.
 * Production getOperationalPersistence() stays local.
 * Dual flags are required even when injecting a non-production db replica.
 */

import { getPersistenceDriver, isSupabasePersistenceEnabled } from "./driver";
import { CanonicalIdMapper } from "./identity-map";
import { MemoryOperationalDb } from "./memory-operational-db";
import { AppointmentRemoteAdapter } from "./appointment-remote-adapter";
import { CustomerRemoteAdapter } from "./customer-remote-adapter";
import { PackageRemoteAdapter } from "./package-remote-adapter";
import { ServiceRemoteAdapter } from "./service-remote-adapter";
import { StoredValueRemoteAdapter } from "./stored-value-remote-adapter";
import { TreatmentRemoteAdapter } from "./treatment-remote-adapter";
import type { IdentityCatalog } from "./identity-catalog";
import type {
  AppointmentTableStore,
  CustomerTableStore,
  PackageTableStore,
  ServiceTableStore,
  StoredValueTableStore,
  TreatmentTableStore,
} from "./operational-rows";

export const REMOTE_PERSISTENCE_REQUIRES_FLAGS =
  "Remote operational persistence requires BEAUTY_OS_PERSISTENCE=supabase and BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE=1";

export interface RemoteOperationalDb
  extends IdentityCatalog,
    PackageTableStore,
    StoredValueTableStore,
    CustomerTableStore,
    AppointmentTableStore,
    ServiceTableStore,
    TreatmentTableStore {}

export interface RemoteOperationalPersistence {
  driver: "supabase";
  mapper: CanonicalIdMapper;
  customers: CustomerRemoteAdapter;
  services: ServiceRemoteAdapter;
  appointments: AppointmentRemoteAdapter;
  treatments: TreatmentRemoteAdapter;
  packages: PackageRemoteAdapter;
  storedValue: StoredValueRemoteAdapter;
}

export function createRemoteOperationalPersistence(
  db: RemoteOperationalDb,
  env: NodeJS.Dict<string>,
  now?: () => Date,
): RemoteOperationalPersistence {
  if (!isSupabasePersistenceEnabled(env) || getPersistenceDriver(env) !== "supabase") {
    throw new Error(REMOTE_PERSISTENCE_REQUIRES_FLAGS);
  }
  const mapper = new CanonicalIdMapper(db);
  return {
    driver: "supabase",
    mapper,
    customers: new CustomerRemoteAdapter(mapper, db, now),
    services: new ServiceRemoteAdapter(mapper, db, now),
    appointments: new AppointmentRemoteAdapter(mapper, db, now),
    treatments: new TreatmentRemoteAdapter(mapper, db, db, now),
    packages: new PackageRemoteAdapter(mapper, db, now),
    storedValue: new StoredValueRemoteAdapter(mapper, db, now),
  };
}

export const REMOTE_FLAGS = {
  BEAUTY_OS_PERSISTENCE: "supabase",
  BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
} as const;

export function createMemoryRemotePersistence(now?: () => Date): {
  db: MemoryOperationalDb;
  remote: RemoteOperationalPersistence;
} {
  const db = new MemoryOperationalDb();
  return { db, remote: createRemoteOperationalPersistence(db, REMOTE_FLAGS, now) };
}
