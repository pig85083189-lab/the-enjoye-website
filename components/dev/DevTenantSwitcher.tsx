"use client";

import { useOrganization } from "@/lib/tenant/OrganizationContext";

/** Development-only tenant switcher for isolation testing. Hidden in production builds. */
export function DevTenantSwitcher() {
  if (process.env.NODE_ENV !== "development") return null;

  return <DevTenantSwitcherInner />;
}

function DevTenantSwitcherInner() {
  const { organization, organizations, switchOrganization } = useOrganization();

  if (organizations.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-3 z-50 min-[1200px]:bottom-4">
      <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-xs shadow-sm">
        <span className="font-semibold tracking-wide text-[#B07A4A]">DEV</span>
        <span className="text-secondary-text">目前店家</span>
        <select
          value={organization.id}
          onChange={(e) => {
            switchOrganization(e.target.value);
          }}
          className="min-h-11 max-w-[160px] rounded-xl border border-border bg-background px-2 text-[13px] font-medium text-text outline-none"
          aria-label="切換 Demo Organization"
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
