"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { StaffNavLink } from "@/components/navigation/StaffNavLink";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import {
  getVisibleNavigationItems,
  groupNavigationItems,
} from "@/lib/navigation";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";

interface StaffNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Tablet / mobile full IA drawer — Esc to close. */
export function StaffNavDrawer({ open, onClose }: StaffNavDrawerProps) {
  const { organization, membership } = useOrganization();

  const grouped = useMemo(() => {
    return groupNavigationItems(getVisibleNavigationItems(membership?.role));
  }, [membership?.role]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 min-[1200px]:hidden" role="dialog" aria-modal="true" aria-label="完整導覽">
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉導覽"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 left-0 flex w-[min(100%,320px)] flex-col bg-surface shadow-lg">
        <div className="flex items-start justify-between border-b border-border px-4 py-4">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-secondary-text">{PLATFORM_NAME}</p>
            <p className="mt-1 font-display text-base text-primary">{organization.name}</p>
          </div>
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <OrgLocationSwitcher compact />
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="完整功能導覽">
          {grouped.map(({ group, items }) => (
            <div key={group.id} className="mb-4">
              {!group.unlabeled ? (
                <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-secondary-text">
                  {group.label}
                </p>
              ) : null}
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <StaffNavLink
                        item={item}
                        onNavigate={onClose}
                        className="flex min-h-11 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium transition-colors"
                        activeClassName="bg-primary-light text-primary"
                        inactiveClassName="text-secondary-text hover:bg-[#FAF7F5] hover:text-text"
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                        {item.label}
                      </StaffNavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
