"use client";

import { useEffect, useState, type ReactNode } from "react";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import {
  setStaffAuthUser,
  type StaffAuthUser,
} from "@/lib/staff-auth/session";
import { applyRemoteMembershipsToClient } from "@/lib/staff-auth/membership-query";
import { listMyStaffMembershipsAction } from "@/lib/staff-auth/actions";
import { emitOrgChange } from "@/lib/tenant/organization-store";
import type { StaffMembership } from "@/types/saas";

export function StaffAuthProvider({
  initialUser,
  initialMemberships = [],
  children,
}: {
  initialUser: StaffAuthUser | null;
  initialMemberships?: StaffMembership[];
  children: ReactNode;
}) {
  useState(() => {
    setStaffAuthUser(initialUser);
    if (initialMemberships.length > 0) {
      applyRemoteMembershipsToClient(initialMemberships);
    }
    return true;
  });

  useEffect(() => {
    setStaffAuthUser(initialUser);
    if (initialMemberships.length > 0) {
      applyRemoteMembershipsToClient(initialMemberships);
      emitOrgChange();
    }
    if (!tryGetSupabaseEnv()) return;
    const supabase = createBrowserClientOrNull();
    if (!supabase) return;

    let cancelled = false;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      const user = data.user
        ? { id: data.user.id, email: data.user.email ?? null }
        : null;
      setStaffAuthUser(user);
      if (!user) return;
      try {
        const rows = await listMyStaffMembershipsAction();
        if (cancelled) return;
        applyRemoteMembershipsToClient(rows);
        emitOrgChange();
      } catch {
        // Access Unavailable remains the honest empty-membership state.
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
        ? { id: session.user.id, email: session.user.email ?? null }
        : null;
      setStaffAuthUser(user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [initialUser, initialMemberships]);

  return <>{children}</>;
}
