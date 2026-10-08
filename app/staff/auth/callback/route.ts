import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { safeStaffNextPath } from "@/lib/staff-auth/redirect";
import { loadStaffSessionGate } from "@/lib/staff-auth/staff-invite-session";
import {
  resolveStaffAuthCallbackNext,
  STAFF_SETUP_PASSWORD_HREF,
} from "@/lib/staff-auth/staff-invite-gate";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = safeStaffNextPath(searchParams.get("next"), {
    allowAuthRoutes: true,
  });

  if (!code || !tryGetSupabaseEnv()) {
    return NextResponse.redirect(
      `${origin}${STAFF_SETUP_PASSWORD_HREF}?error=invalid`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}${STAFF_SETUP_PASSWORD_HREF}?error=expired`,
    );
  }

  const sessionGate = await loadStaffSessionGate();
  return NextResponse.redirect(
    `${origin}${resolveStaffAuthCallbackNext({
      gate: sessionGate.gate,
      requestedNext,
    })}`,
  );
}
