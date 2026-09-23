"use client";

import { Card } from "@/components/ui/Card";
import { useOrganizationOptional } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({
  title,
  description = "功能即將推出",
}: ComingSoonProps) {
  const org = useOrganizationOptional();
  const brand = org?.organization.name ?? PLATFORM_NAME;

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card padding="lg" className="w-full max-w-md text-center">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">{PLATFORM_NAME}</p>
        <p className="mt-1 font-display text-sm tracking-[0.14em] text-primary">{brand}</p>
        <h1 className="mt-4 text-2xl font-semibold text-text">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-secondary-text">{description}</p>
      </Card>
    </div>
  );
}
