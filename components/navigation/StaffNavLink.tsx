"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLeaveGuard } from "@/features/treatments/LeaveGuard";
import { isNavItemActive, shouldUseLeaveGuard, type NavigationItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface StaffNavLinkProps {
  item: NavigationItem;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  children: ReactNode;
  onNavigate?: () => void;
}

export function StaffNavLink({
  item,
  className,
  activeClassName,
  inactiveClassName,
  children,
  onNavigate,
}: StaffNavLinkProps) {
  const pathname = usePathname();
  const { requestNavigate } = useLeaveGuard();
  const active = isNavItemActive(item, pathname);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (shouldUseLeaveGuard(pathname)) {
          event.preventDefault();
          requestNavigate(item.href);
        }
        onNavigate?.();
      }}
      className={cn(className, active ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  );
}
