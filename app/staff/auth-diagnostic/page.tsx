import { redirect } from "next/navigation";
import { runAuthenticatedRlsSmoke } from "@/lib/staff-auth/authenticated-rls-smoke";

export const dynamic = "force-dynamic";

function passFail(value: boolean | null): string {
  if (value === true) return "PASS";
  if (value === false) return "FAIL";
  return "NOT VERIFIED";
}

export default async function StaffAuthDiagnosticPage() {
  const result = await runAuthenticatedRlsSmoke();
  if (!result.authenticated) {
    redirect("/staff/login?next=%2Fstaff%2Fauth-diagnostic");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-[15px] leading-relaxed text-text">
      <h1 className="text-xl font-semibold">Authenticated Owner RLS Smoke</h1>
      <p className="mt-2 text-sm text-secondary-text">
        Temporary Preview diagnostic. Cookie session only. No token displayed.
      </p>
      <dl className="mt-8 space-y-3">
        <div>
          <dt className="text-secondary-text">Auth session</dt>
          <dd className="font-medium">authenticated</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Operational staff</dt>
          <dd className="font-medium">{result.operationalStaffId || "—"}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Role</dt>
          <dd className="font-medium">{result.role || "—"}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Organization membership</dt>
          <dd className="font-medium">
            {passFail(result.organizationMembership)}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">Organization role</dt>
          <dd className="font-medium">{result.organizationRole || "—"}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Location access</dt>
          <dd className="font-medium">{passFail(result.locationAccess)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Unrelated organization</dt>
          <dd className="font-medium">
            {passFail(result.unrelatedOrganizationMembership)}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">Unrelated location</dt>
          <dd className="font-medium">
            {passFail(result.unrelatedLocationAccess)}
          </dd>
        </div>
      </dl>
    </main>
  );
}
