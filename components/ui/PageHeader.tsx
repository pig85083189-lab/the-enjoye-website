"use client";

import type { ReactNode } from "react";
import { useOrganizationOptional } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  meta?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, description, meta, actions }: PageHeaderProps) {
  const org = useOrganizationOptional();
  const brand = org?.organization.name ?? PLATFORM_NAME;

  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">{PLATFORM_NAME}</p>
        <p className="font-display text-sm tracking-[0.14em] text-primary">{brand}</p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[28px]">
            {title}
            {subtitle ? <span className="text-primary">，{subtitle}</span> : null}
          </h1>
          {description ? (
            <p className="mt-1.5 text-[15px] leading-relaxed text-secondary-text">{description}</p>
          ) : null}
          {meta ? <p className="mt-2 text-sm text-secondary-text">{meta}</p> : null}
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
