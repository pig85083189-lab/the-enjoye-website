"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { BottomNavigation } from "@/components/layout/BottomNavigation";
import { StaffNavDrawer } from "@/components/layout/StaffNavDrawer";
import { StaffSidebar } from "@/components/layout/StaffSidebar";
import { DevTenantSwitcher } from "@/components/dev/DevTenantSwitcher";
import { LeaveGuardProvider } from "@/features/treatments/LeaveGuard";
import { getSessionRaw, subscribeAuth } from "@/lib/auth";
import { OrganizationProvider, useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

interface StaffShellProps {
  children: ReactNode;
}

function StaffShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { organization, currentLocation, membership } = useOrganization();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isTreatmentWorkspace = pathname.startsWith("/staff/treatments/");
  const isCalendarSurface =
    pathname.startsWith("/staff/calendar") || pathname.startsWith("/staff/appointments");
  const useWideContent = isTreatmentWorkspace || isCalendarSurface;

  return (
    <div className="flex min-h-screen bg-background">
      <StaffSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Tablet / mobile context bar */}
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-sm min-[1200px]:hidden">
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-text hover:bg-primary-light/60"
            aria-label="開啟完整導覽"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text">{organization.name}</p>
            <p className="truncate text-xs text-secondary-text">
              {currentLocation?.name ?? "分店"}
              {membership?.displayName ? ` · ${membership.displayName}` : ""}
            </p>
          </div>
        </header>

        <main
          className={cn(
            "mx-auto w-full min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pt-6 min-[1200px]:pb-10 min-[1200px]:pt-7",
            useWideContent
              ? "max-w-3xl sm:max-w-4xl min-[1200px]:max-w-[1520px] min-[1200px]:px-8 xl:max-w-[1680px] xl:px-10"
              : "max-w-3xl sm:max-w-4xl min-[1200px]:max-w-5xl min-[1200px]:px-8",
          )}
        >
          {children}
        </main>
        <BottomNavigation />
      </div>
      <StaffNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <DevTenantSwitcher />
    </div>
  );
}

export function StaffShell({ children }: StaffShellProps) {
  const router = useRouter();
  const sessionRaw = useSyncExternalStore(subscribeAuth, getSessionRaw, () => null);

  useEffect(() => {
    if (sessionRaw === null) {
      router.replace("/staff/login");
    }
  }, [sessionRaw, router]);

  if (sessionRaw === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-secondary-text">
        載入中…
      </div>
    );
  }

  return (
    <OrganizationProvider>
      <LeaveGuardProvider>
        <StaffShellChrome>{children}</StaffShellChrome>
      </LeaveGuardProvider>
    </OrganizationProvider>
  );
}
