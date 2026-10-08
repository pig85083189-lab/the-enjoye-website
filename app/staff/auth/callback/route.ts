import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { safeStaffNextPath } from "@/lib/staff-auth/redirect";
import { loadStaffSessionGate } from "@/lib/staff-auth/staff-invite-session";
import {
  STAFF_ACCESS_UNAVAILABLE_HREF,
  STAFF_SETUP_PASSWORD_HREF,
  STAFF_TODAY_HREF,
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
  if (sessionGate.gate === "setup_password") {
    return NextResponse.redirect(`${origin}${STAFF_SETUP_PASSWORD_HREF}`);
  }
  if (sessionGate.gate === "access_unavailable") {
    return NextResponse.redirect(`${origin}${STAFF_ACCESS_UNAVAILABLE_HREF}`);
  }
  if (sessionGate.gate === "ok") {
    const next =
      requestedNext.startsWith("/staff/auth") ? STAFF_TODAY_HREF : requestedNext;
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}${STAFF_SETUP_PASSWORD_HREF}?error=invalid`);
}
