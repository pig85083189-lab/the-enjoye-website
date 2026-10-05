/**
 * Shared explicit remote-pilot switch.
 *
 * Fail closed unless the named env is exactly "1".
 * Production is not hard-off: an explicit Production env can enable the path.
 * Missing env keeps Production, Preview, and Development off.
 * Independent of BEAUTY_OS_PERSISTENCE / BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 *
 * Server Components must keep importing the domain *-flag.ts files so the
 * adapter graph stays out of RSC. Do not scatter Production exceptions in pages.
 */

export function isExplicitRemotePilotEnabled(
  envName: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env[envName] === "1";
}
