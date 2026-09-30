/**
 * Existing OWNER bootstrap (staff-001 / THE ENJOYE OWNER).
 *
 * Do NOT hardcode production email or password in the app.
 *
 * Procedure:
 * 1. In the Supabase dashboard, create the first Auth user (email + password)
 *    for the shop owner. Copy auth.users.id (UUID).
 * 2. Set NEXT_PUBLIC_BEAUTY_OS_OWNER_AUTH_USER_ID=<that UUID> in the server env.
 *    This only maps the UUID onto mem-enjoye-owner.authUserId.
 *    It is not a password and must never be a password.
 * 3. Sign in at /staff/login with that email + password.
 * 4. Beauty OS resolves:
 *    auth.users.id → StaffMembership.authUserId → StaffMembership.userId (staff-001)
 * 5. Existing Appointment / Treatment / Schedule / Transaction rows that already
 *    store staff-001 keep working. Do not rewrite them to the Auth UUID.
 *
 * Rollback:
 * - Unset NEXT_PUBLIC_BEAUTY_OS_OWNER_AUTH_USER_ID
 * - StaffMembership.userId and historical staffId values stay staff-001
 *
 * Optional SQL (no secrets in git):
 *   supabase/scripts/bootstrap_owner_staff_auth_membership.sql
 */
export const OWNER_BOOTSTRAP_ENV = "NEXT_PUBLIC_BEAUTY_OS_OWNER_AUTH_USER_ID";
export const OWNER_BOOTSTRAP_SQL =
  "supabase/scripts/bootstrap_owner_staff_auth_membership.sql";

export function ownerBootstrapProcedure(): string[] {
  return [
    "Create the first Supabase Auth owner in the dashboard (email + password).",
    "Copy auth.users.id (UUID only).",
    `Set ${OWNER_BOOTSTRAP_ENV} to that UUID. Never put email or password in env.`,
    `Optional: apply ${OWNER_BOOTSTRAP_SQL} with the same UUID placeholder replaced at apply time.`,
    "Sign in at /staff/login. Mapping is auth uid → mem-enjoye-owner.authUserId → staff-001.",
    "Never put a production password in env, source, or StaffMembership.",
  ];
}
