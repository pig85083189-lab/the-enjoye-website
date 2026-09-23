"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface LeaveGuardValue {
  setBlocked: (blocked: boolean) => void;
  requestNavigate: (href: string) => void;
}

const LeaveGuardContext = createContext<LeaveGuardValue | null>(null);

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const requestNavigate = useCallback(
    (href: string) => {
      if (!blocked) {
        router.push(href);
        return;
      }
      setPendingHref(href);
    },
    [blocked, router],
  );

  const value = useMemo(
    () => ({
      setBlocked,
      requestNavigate,
    }),
    [requestNavigate],
  );

  return (
    <LeaveGuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={pendingHref !== null}
        title="本次療程紀錄尚未完成"
        description="資料已自動儲存，你可以稍後回來繼續填寫。"
        cancelLabel="繼續填寫"
        confirmLabel="離開"
        onCancel={() => setPendingHref(null)}
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          setBlocked(false);
          if (href) router.push(href);
        }}
      />
    </LeaveGuardContext.Provider>
  );
}

export function useLeaveGuard(): LeaveGuardValue {
  const ctx = useContext(LeaveGuardContext);
  if (!ctx) {
    return {
      setBlocked: () => undefined,
      requestNavigate: () => undefined,
    };
  }
  return ctx;
}
