import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { safeStaffNextPath } from "@/lib/staff-auth/redirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeStaffNextPath(searchParams.get("next"), {
    allowAuthRoutes: true,
  });

  if (!code || !tryGetSupabaseEnv()) {
    return NextResponse.redirect(
      `${origin}/staff/auth/setup-password?error=invalid`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/staff/auth/setup-password?error=expired`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
