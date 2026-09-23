"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSession, getSession } from "@/lib/auth";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import {
  getMoreHubItems,
  groupNavigationItems,
} from "@/lib/navigation";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { LogOut } from "lucide-react";

export default function MorePage() {
  const router = useRouter();
  const { organization, membership, organizations } = useOrganization();
  const session = getSession();
  const grouped = groupNavigationItems(getMoreHubItems(membership?.role));

  return (
    <div className="space-y-6">
      <PageHeader
        title="更多"
        description={`${PLATFORM_NAME} · ${organization.name}`}
      />

      <Card padding="lg" className="space-y-3">
        <p className="text-sm font-medium text-text">目前分店</p>
        <OrgLocationSwitcher
          compact
          showOrganizationSwitch={organizations.length > 1}
        />
        <p className="text-xs text-secondary-text">
          {membership?.displayName ?? session?.name ?? "員工"} · {membership?.role ?? "STAFF"}
        </p>
      </Card>

      {grouped.map(({ group, items }) => (
        <section key={group.id} className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-secondary-text">
            {group.unlabeled ? "服務" : group.label}
          </h2>
          <div className="space-y-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.id} href={item.href} className="block">
                  <Card padding="md" className="transition-colors hover:border-primary/30">
                    <div className="flex min-h-11 items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-light text-primary">
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold text-text">{item.label}</p>
                        <p className="mt-0.5 text-sm text-secondary-text">
                          {item.description}
                        </p>
                      </div>
                      {item.status === "placeholder" || item.status === "future" ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-secondary-text">
                          {item.status === "future" ? "Soon" : "預留"}
                        </span>
                      ) : null}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={() => {
          clearSession();
          router.replace("/staff/login");
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-sm font-medium text-secondary-text"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        登出
      </button>
    </div>
  );
}
