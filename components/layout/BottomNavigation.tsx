"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { StaffNavLink } from "@/components/navigation/StaffNavLink";
import { useLeaveGuard } from "@/features/treatments/LeaveGuard";
import {
  getMobilePrimaryItems,
  MOBILE_MORE_HREF,
  shouldUseLeaveGuard,
} from "@/lib/navigation";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

export function BottomNavigation() {
  const pathname = usePathname();
  const { requestNavigate } = useLeaveGuard();
  const { membership } = useOrganization();

  const primary = useMemo(
    () => getMobilePrimaryItems(membership?.role),
    [membership?.role],
  );

  const moreActive =
    pathname === MOBILE_MORE_HREF || pathname.startsWith(`${MOBILE_MORE_HREF}/`);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm min-[1200px]:hidden"
      aria-label="主要導覽"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)]">
        {primary.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id} className="flex-1">
              <StaffNavLink
                item={item}
                className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors"
                activeClassName="text-primary"
                inactiveClassName="text-secondary-text"
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="font-medium">{item.label}</span>
              </StaffNavLink>
            </li>
          );
        })}
        <li className="flex-1">
          <Link
            href={MOBILE_MORE_HREF}
            aria-current={moreActive ? "page" : undefined}
            onClick={(event) => {
              if (shouldUseLeaveGuard(pathname)) {
                event.preventDefault();
                requestNavigate(MOBILE_MORE_HREF);
              }
            }}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors",
              moreActive ? "text-primary" : "text-secondary-text",
            )}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            <span className="font-medium">更多</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
