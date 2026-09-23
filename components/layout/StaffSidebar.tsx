"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut } from "lucide-react";
import { StaffNavLink } from "@/components/navigation/StaffNavLink";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import { clearSession, getSession } from "@/lib/auth";
import {
  getVisibleNavigationItems,
  groupNavigationItems,
} from "@/lib/navigation";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import { cn } from "@/lib/utils";

export function StaffSidebar() {
  const { organization, membership, currentLocation } = useOrganization();
  const session = getSession();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    sales: true,
    crm: true,
    insights: true,
    team: true,
    system: true,
  });

  const grouped = useMemo(() => {
    const items = getVisibleNavigationItems(membership?.role);
    return groupNavigationItems(items);
  }, [membership?.role]);

  const staffName = membership?.displayName ?? session?.name ?? "美容師";

  return (
    <aside className="hidden w-[232px] shrink-0 border-r border-border bg-surface min-[1200px]:flex min-[1200px]:flex-col">
      <div className="border-b border-border px-5 py-6">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">{PLATFORM_NAME}</p>
        <p className="mt-1 font-display text-lg tracking-[0.08em] text-primary">
          {organization.name}
        </p>
        <p className="mt-1 truncate text-xs text-secondary-text">
          {currentLocation?.name ?? "未選擇分店"}
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3" aria-label="側邊導覽">
        {grouped.map(({ group, items }) => {
          if (group.unlabeled) {
            return (
              <ul key={group.id} className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <StaffNavLink
                        item={item}
                        className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium transition-colors"
                        activeClassName="bg-primary-light text-primary"
                        inactiveClassName="text-secondary-text hover:bg-[#FAF7F5] hover:text-text"
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        {item.status === "placeholder" || item.status === "future" ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-secondary-text/80">
                            {item.status === "future" ? "Soon" : "預留"}
                          </span>
                        ) : null}
                      </StaffNavLink>
                    </li>
                  );
                })}
              </ul>
            );
          }

          const open = openGroups[group.id] ?? true;
          return (
            <div key={group.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-xs font-semibold tracking-wide text-secondary-text"
                aria-expanded={open}
                onClick={() =>
                  setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))
                }
              >
                {group.label}
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", open ? "rotate-0" : "-rotate-90")}
                  aria-hidden
                />
              </button>
              {open ? (
                <ul className="mt-1 space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <StaffNavLink
                          item={item}
                          className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[14px] font-medium transition-colors"
                          activeClassName="bg-primary-light text-primary"
                          inactiveClassName="text-secondary-text hover:bg-[#FAF7F5] hover:text-text"
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          <span className="flex-1">{item.label}</span>
                        </StaffNavLink>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-border p-4">
        <OrgLocationSwitcher />
        <div className="rounded-2xl bg-primary-light/40 px-3 py-3">
          <p className="text-xs text-secondary-text">目前員工</p>
          <p className="mt-0.5 text-sm font-medium text-text">{staffName}</p>
          <p className="text-xs text-secondary-text">{membership?.role ?? "STAFF"}</p>
        </div>
        <Link
          href="/staff/login"
          onClick={() => clearSession()}
          className="flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-secondary-text transition-colors hover:bg-[#FAF7F5] hover:text-text"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          登出
        </Link>
      </div>
    </aside>
  );
}
