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
import {
  getMembership,
  getOrganizationById,
  getOrganizationSnapshot,
  getSubscription,
  listLocations,
  listOrganizationsForUser,
  persistCurrentLocation,
  persistOrganizationId,
  resolveCurrentLocation,
  subscribeOrganization,
} from "./organization-store";
import { getCurrentUserId } from "./access";
import { canUseFeature } from "./entitlements";
import type { FeatureKey } from "@/types/saas";

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

function AccessUnavailablePanel() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <p className="text-lg font-semibold text-text">Access unavailable</p>
      <p className="max-w-sm text-sm text-secondary-text">
        目前帳號沒有可用的店家 membership。請重新登入，或聯絡平台管理員。
      </p>
      <p className="text-xs text-secondary-text">
        Prototype application boundary · 非正式 security boundary
      </p>
    </div>
  );
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeOrganization,
    getOrganizationSnapshot,
    () => "ssr",
  );

  const value = useMemo<OrganizationContextValue>(() => {
    const userId = getCurrentUserId();
    const organizationId = snapshot.split("|")[0];
    const organizations = listOrganizationsForUser(userId);
    // Avoid SSR→organizations[0] flash of the wrong tenant
    const organization =
      organizationId === "ssr" || organizationId === "none"
        ? undefined
        : getOrganizationById(organizationId);

    if (!organization) {
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
    const membership = getMembership(organization.id, userId);
    const subscription = getSubscription(organization.id);

    return {
      organization,
      organizations,
      currentLocation,
      locations,
      membership,
      subscription,
      accessUnavailable: false,
      switchOrganization: (id: string) => persistOrganizationId(id, userId),
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
