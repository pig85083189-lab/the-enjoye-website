"use client";

import { PackagePlansPageClient } from "@/features/packages/PackagePlansPageClient";
import { RemotePackagePlans } from "@/features/packages/RemotePackagePlans";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export default function PackagePlansPage() {
  const { organization } = useOrganization();
  // Production finance tenancy uses canonical Supabase definitions, not browser-local plans.
  if (organization.id === "org-the-enjoye") {
    return <RemotePackagePlans organizationId={organization.id} />;
  }
  return <PackagePlansPageClient />;
}
