/**
 * Persistence driver. Production default is local (localStorage stores).
 * Supabase must never auto-enable.
 */

export type PersistenceDriver = "local" | "supabase";

const LOCAL: PersistenceDriver = "local";

/**
 * Resolve driver. Requires BOTH:
 *   BEAUTY_OS_PERSISTENCE=supabase
 *   BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE=1
 * Otherwise always local.
 */
export function getPersistenceDriver(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): PersistenceDriver {
  const requested = (env.BEAUTY_OS_PERSISTENCE ?? LOCAL).trim().toLowerCase();
  const allowRemote = env.BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE === "1";
  if (requested === "supabase" && allowRemote) {
    return "supabase";
  }
  return LOCAL;
}

export function isSupabasePersistenceEnabled(
  env?: NodeJS.Dict<string>,
): boolean {
  return getPersistenceDriver(env) === "supabase";
}
