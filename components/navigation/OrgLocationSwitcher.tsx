"use client";

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";

interface OrgLocationSwitcherProps {
  compact?: boolean;
  className?: string;
  showOrganizationSwitch?: boolean;
}

/**
 * Location switch uses persistCurrentLocation via context (Phase 4.5B validated).
 * Organization switch only when user has multiple memberships (or always in compact footer for owners).
 */
export function OrgLocationSwitcher({
  compact = false,
  className,
  showOrganizationSwitch,
}: OrgLocationSwitcherProps) {
  const {
    organization,
    organizations,
    currentLocation,
    locations,
    switchOrganization,
    switchLocation,
  } = useOrganization();

  const allowOrgSwitch = useMemo(() => {
    if (typeof showOrganizationSwitch === "boolean") return showOrganizationSwitch;
    return organizations.length > 1;
  }, [organizations.length, showOrganizationSwitch]);

  return (
    <div className={cn("space-y-2", className)}>
      {!compact ? (
        <div>
          <p className="text-[10px] tracking-[0.16em] text-secondary-text">{PLATFORM_NAME}</p>
          {allowOrgSwitch ? (
            <label className="mt-1 block">
              <span className="sr-only">目前店家</span>
              <select
                value={organization.id}
                onChange={(e) => switchOrganization(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-medium text-primary outline-none"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-1 font-display text-base tracking-[0.06em] text-primary">
              {organization.name}
            </p>
          )}
        </div>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3">
        <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="sr-only">目前分店</span>
        <select
          value={currentLocation?.id ?? ""}
          onChange={(e) => {
            if (e.target.value) switchLocation(e.target.value);
          }}
          className="min-h-11 w-full bg-transparent text-sm font-medium text-text outline-none"
          aria-label="切換分店"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
              {loc.isPrimary ? "（主店）" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
