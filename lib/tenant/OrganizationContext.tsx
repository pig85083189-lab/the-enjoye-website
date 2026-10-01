"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  Location,
  Organization,
  OrganizationSubscription,
  StaffMembership,
} from "@/types/saas";
import { AccessUnavailablePanel } from "@/features/auth/AccessUnavailable";
import { parseOrganizationId } from "@/lib/tenant/organization-snapshot";
import {
  getMembership,
  getOrganizationById,
  getOrganizationSnapshot,
  getSubscription,
  listLocations,
  persistCurrentLocation,
  persistOrganizationId,
  resolveCurrentLocation,
  subscribeOrganization,
} from "./organization-store";
import { getCurrentUserId } from "./access";
import { canUseFeature } from "./entitlements";
import type { FeatureKey } from "@/types/saas";
import { resolveActiveMembershipsForAuthUser } from "@/lib/staff-auth/identity";
import { getStaffAuthUserId } from "@/lib/staff-auth/session";

interface OrganizationContextValue {
  organization: Organization;
  organizations: Organization[];
  currentLocation: Location | undefined;
  locations: Location[];
  membership: StaffMembership | undefined;
  subscription: OrganizationSubscription | undefined;
  accessUnavailable: boolean;
  switchOrganization: (organizationId: string) => boolean;
  switchLocation: (locationId: string) => boolean;
  hasFeature: (feature: FeatureKey) => boolean;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export { parseOrganizationId };

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeOrganization,
    getOrganizationSnapshot,
    () => "ssr",
  );

  const value = useMemo<OrganizationContextValue>(() => {
    const authUserId = getStaffAuthUserId();
    const authMemberships = resolveActiveMembershipsForAuthUser(authUserId);
    const userId = getCurrentUserId();
    const organizationId = parseOrganizationId(snapshot);
    const organizations = authMemberships
      .map((row) => getOrganizationById(row.organizationId))
      .filter((org): org is Organization => Boolean(org));
    const organization =
      organizationId === "ssr" || organizationId === "none"
        ? undefined
        : getOrganizationById(organizationId);

    const noMembership = Boolean(authUserId) && authMemberships.length === 0;

    if (!organization || noMembership) {
      return {
        organization: {
          id: organizationId === "ssr" ? "ssr" : "none",
          name: organizationId === "ssr" ? "載入中…" : "Access unavailable",
          slug: organizationId === "ssr" ? "ssr" : "none",
          timezone: "Asia/Taipei",
          currency: "TWD",
          locale: "zh-TW",
          status: "SUSPENDED",
          createdAt: "",
          updatedAt: "",
        },
        organizations: organizationId === "ssr" ? organizations : [],
        currentLocation: undefined,
        locations: [],
        membership: undefined,
        subscription: undefined,
        accessUnavailable: organizationId !== "ssr",
        switchOrganization: () => false,
        switchLocation: () => false,
        hasFeature: () => false,
      };
    }

    const locations = listLocations(organization.id);
    const currentLocation = resolveCurrentLocation(organization.id);
    const membership =
      authMemberships.find((row) => row.organizationId === organization.id) ??
      getMembership(organization.id, userId);
    const subscription = getSubscription(organization.id);

    return {
      organization,
      organizations,
      currentLocation,
      locations,
      membership,
      subscription,
      accessUnavailable: false,
      switchOrganization: (id: string) => {
        const target = authMemberships.find((row) => row.organizationId === id);
        if (!target) return false;
        return persistOrganizationId(id, target.userId);
      },
      switchLocation: (locationId: string) =>
        persistCurrentLocation(organization.id, locationId),
      hasFeature: (feature: FeatureKey) =>
        canUseFeature(subscription?.planId ?? "BUSINESS", feature),
    };
  }, [snapshot]);

  if (value.organization.id === "ssr") {
    return (
      <OrganizationContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-background text-sm text-secondary-text">
          載入中…
        </div>
      </OrganizationContext.Provider>
    );
  }

  if (value.accessUnavailable) {
    return (
      <OrganizationContext.Provider value={value}>
        <AccessUnavailablePanel />
      </OrganizationContext.Provider>
    );
  }

  return (
    <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) {
    throw new Error("useOrganization must be used within OrganizationProvider");
  }
  return ctx;
}

/** Safe for components that may render before provider during SSR edges */
export function useOrganizationOptional(): OrganizationContextValue | null {
  return useContext(OrganizationContext);
}

export function useSwitchOrganization() {
  const { switchOrganization } = useOrganization();
  return useCallback((id: string) => switchOrganization(id), [switchOrganization]);
}
