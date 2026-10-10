/** SaaS-ready domain types — Phase 4.5 (prototype; no billing / remote) */

export type OrganizationStatus = "ACTIVE" | "TRIAL" | "SUSPENDED" | "ARCHIVED";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  phone?: string;
  email?: string;
  address?: string;
  timezone: string;
  currency: string;
  locale: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  organizationId: string;
  name: string;
  code?: string;
  phone?: string;
  address?: string;
  timezone?: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Future: RECEPTIONIST | ACCOUNTANT — not enforced this phase */
export type StaffRole = "OWNER" | "MANAGER" | "STAFF" | "RECEPTIONIST" | "ACCOUNTANT";

export interface StaffMembership {
  id: string;
  organizationId: string;
  /** Operational staff identity (staff-001). Never an auth UUID. */
  userId: string;
  /**
   * Supabase auth.users.id mapping (Strategy B).
   * Null means this membership has no login binding yet.
   */
  authUserId?: string | null;
  /** Invite / login contact. Never a join key. */
  email?: string | null;
  locationIds: string[];
  role: StaffRole;
  displayName: string;
  phone?: string | null;
  title?: string | null;
  isActive: boolean;
  createdAt: string;
}

export type PlanId = "FREE_TRIAL" | "STARTER" | "PRO" | "BUSINESS";

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";

export interface OrganizationSubscription {
  organizationId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  trialEndsAt?: string | null;
  currentPeriodEndsAt?: string | null;
}

export type FeatureKey =
  | "CUSTOMER_CRM"
  | "CONSULTATION"
  | "TREATMENTS"
  | "APPOINTMENTS"
  | "PHOTOS"
  | "REPORTS"
  | "MULTI_LOCATION"
  | "ADVANCED_PERMISSIONS";

export type OrgScoped = {
  organizationId: string;
};

export type OrgEntityRef = OrgScoped & {
  id: string;
};
