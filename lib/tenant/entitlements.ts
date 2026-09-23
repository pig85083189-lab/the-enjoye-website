import type { FeatureKey, PlanId } from "@/types/saas";

const PLAN_FEATURES: Record<PlanId, FeatureKey[]> = {
  FREE_TRIAL: [
    "CUSTOMER_CRM",
    "CONSULTATION",
    "TREATMENTS",
    "APPOINTMENTS",
    "PHOTOS",
  ],
  STARTER: [
    "CUSTOMER_CRM",
    "CONSULTATION",
    "TREATMENTS",
    "APPOINTMENTS",
    "PHOTOS",
  ],
  PRO: [
    "CUSTOMER_CRM",
    "CONSULTATION",
    "TREATMENTS",
    "APPOINTMENTS",
    "PHOTOS",
    "REPORTS",
    "MULTI_LOCATION",
  ],
  BUSINESS: [
    "CUSTOMER_CRM",
    "CONSULTATION",
    "TREATMENTS",
    "APPOINTMENTS",
    "PHOTOS",
    "REPORTS",
    "MULTI_LOCATION",
    "ADVANCED_PERMISSIONS",
  ],
};

/** Prototype entitlement check — do not lock UI heavily in Phase 4.5. */
export function canUseFeature(plan: PlanId, feature: FeatureKey): boolean {
  return PLAN_FEATURES[plan]?.includes(feature) ?? false;
}
