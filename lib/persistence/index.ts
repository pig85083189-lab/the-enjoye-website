import { getPersistenceDriver } from "./driver";
import { localOperationalPersistence } from "./local-adapter";
import { supabaseOperationalPersistence } from "./supabase-adapter";
import type { OperationalPersistence } from "./types";

export {
  getPersistenceDriver,
  isSupabasePersistenceEnabled,
  type PersistenceDriver,
} from "./driver";
export { localOperationalPersistence } from "./local-adapter";
export { supabaseOperationalPersistence } from "./supabase-adapter";
export {
  FORBIDDEN_STORED_COLUMNS,
  OPERATIONAL_MIGRATION_FILE,
  OPERATIONAL_TABLES,
  SOURCE_OF_TRUTH,
} from "./schema-contract";
export { DEMO_RESIDUE_NOT_LEDGER, SEED_BOUNDARY } from "./seed-policy";
export { CanonicalIdMapper } from "./identity-map";
export { UnmappedIdentityError, IdentityCatalogError } from "./identity-errors";
export { MemoryOperationalDb } from "./memory-operational-db";
export {
  createMemoryRemotePersistence,
  createRemoteOperationalPersistence,
  REMOTE_FLAGS,
  REMOTE_PERSISTENCE_REQUIRES_FLAGS,
} from "./remote-factory";
export { loadAuthenticatedIdentityCatalog } from "./authenticated-identity-catalog";
export { SnapshotIdentityCatalog } from "./snapshot-identity-catalog";
export { CustomerRemoteAdapter } from "./customer-remote-adapter";
export { AppointmentRemoteAdapter } from "./appointment-remote-adapter";
export {
  DEMO_SEED_FLAG,
  isDemoSeedEnabled,
  promoteDemoRemainingSessionsToRemote,
  REMOTE_DEMO_PROMOTION_MESSAGE,
  assertRemoteCustomerAllowed,
  assertRemoteAppointmentAllowed,
} from "./demo-firewall";
export type { OperationalPersistence, CustomerPersistence } from "./types";

/**
 * Persistence port for Phase 5A-2. Existing stores are still the live path.
 * Default driver is local even if BEAUTY_OS_PERSISTENCE is unset or invalid.
 */
export function getOperationalPersistence(
  env?: NodeJS.Dict<string>,
): OperationalPersistence {
  if (getPersistenceDriver(env) === "supabase") {
    return supabaseOperationalPersistence;
  }
  return localOperationalPersistence;
}
