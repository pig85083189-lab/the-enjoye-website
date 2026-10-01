import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("authenticated RLS smoke diagnostic", () => {
  it("uses cookie createClient + getUser and never a service-role client", () => {
    const smoke = source("lib/staff-auth/authenticated-rls-smoke.ts");
    const page = source("app/staff/auth-diagnostic/page.tsx");
    expect(smoke).toMatch(/from \"@\/lib\/supabase\/server\"/);
    expect(smoke).toMatch(/createClient\(\)/);
    expect(smoke).toMatch(/auth\.getUser\(\)/);
    expect(smoke).toMatch(/user_has_org_membership/);
    expect(smoke).toMatch(/user_org_role/);
    expect(smoke).toMatch(/user_can_access_location/);
    expect(smoke).not.toMatch(/createServiceRoleClient/);
    expect(smoke).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(smoke).not.toMatch(/tryGetSupabaseServiceRoleKey/);
    expect(smoke).not.toMatch(/searchParams/);
    expect(smoke).not.toMatch(/access_token|refresh_token|Authorization/);
    expect(page).not.toMatch(/searchParams/);
    expect(page).not.toMatch(/createServiceRoleClient/);
    expect(page).toMatch(/runAuthenticatedRlsSmoke/);
    expect(page).toMatch(/redirect\(\"\/staff\/login\?next=%2Fstaff%2Fauth-diagnostic\"\)/);
  });

  it("does not accept caller-supplied identity and does not print JWT", () => {
    const smoke = source("lib/staff-auth/authenticated-rls-smoke.ts");
    const page = source("app/staff/auth-diagnostic/page.tsx");
    expect(smoke).not.toMatch(/authUserId\s*[:=]/);
    expect(smoke).not.toMatch(/accessToken|idToken|jwt/i);
    expect(page).not.toMatch(/accessToken|idToken|jwt/i);
    expect(page).toMatch(/No token displayed/);
    expect(page).toMatch(/Auth session/);
    expect(page).toMatch(/Organization membership/);
    expect(page).toMatch(/Location access/);
  });

  it("negative checks use nonexistent UUIDs instead of a second tenant", () => {
    const smoke = source("lib/staff-auth/authenticated-rls-smoke.ts");
    expect(smoke).toMatch(/00000000-0000-4000-8000-000000000001/);
    expect(smoke).toMatch(/00000000-0000-4000-8000-000000000002/);
    expect(smoke).not.toMatch(/insert\(/);
    expect(smoke).not.toMatch(/from\(\"customers\"\)|from\(\"appointments\"\)/);
  });
});
