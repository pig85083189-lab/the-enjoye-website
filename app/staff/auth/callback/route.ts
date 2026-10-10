import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv, tryGetSupabaseEnv } from "@/lib/supabase/env";
import {
  STAFF_SUPABASE_COOKIE_ENCODING,
  STAFF_SUPABASE_COOKIE_OPTIONS,
} from "@/lib/supabase/auth-cookie-options";
import { safeStaffNextPath } from "@/lib/staff-auth/redirect";
import { loadStaffSessionGate } from "@/lib/staff-auth/staff-invite-session";
import {
  applyAuthCookiesToRedirect,
  cookieNamesIncludePkceVerifier,
  resolveStaffAuthCallbackDecision,
  type AuthCookieToSet,
} from "@/lib/staff-auth/staff-auth-callback";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const flow = searchParams.get("flow");
  const requestedNext = safeStaffNextPath(searchParams.get("next"), {
    allowAuthRoutes: true,
  });
  const cookieStore = await cookies();
  const pre = resolveStaffAuthCallbackDecision({
    hasCode: Boolean(code),
    envConfigured: Boolean(tryGetSupabaseEnv()),
    hasPkceVerifierCookie: cookieNamesIncludePkceVerifier(cookieStore.getAll()),
    flow,
    requestedNext,
    exchangeError: null,
    gate: "login",
    authenticated: false,
  });
  if (!pre.exchange || !code) {
    return NextResponse.redirect(`${origin}${pre.redirectPath}`);
  }

  const env = getSupabaseEnv();
  const pending: AuthCookieToSet[] = [];
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookieEncoding: STAFF_SUPABASE_COOKIE_ENCODING,
    cookieOptions: STAFF_SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers = {}) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Redirect response still receives the cookies below.
          }
          pending.push({ name, value, options });
        });
        pendingHeaders = headers;
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const failed = resolveStaffAuthCallbackDecision({
      hasCode: true,
      envConfigured: true,
      hasPkceVerifierCookie: true,
      flow,
      requestedNext,
      exchangeError: true,
      gate: "login",
      authenticated: false,
    });
    return applyAuthCookiesToRedirect(
      NextResponse.redirect(`${origin}${failed.redirectPath}`),
      pending,
      pendingHeaders,
    );
  }

  const sessionGate = await loadStaffSessionGate();
  const succeeded = resolveStaffAuthCallbackDecision({
    hasCode: true,
    envConfigured: true,
    hasPkceVerifierCookie: true,
    flow,
    requestedNext,
    exchangeError: false,
    gate: sessionGate.gate,
    authenticated: sessionGate.authenticated,
  });
  return applyAuthCookiesToRedirect(
    NextResponse.redirect(`${origin}${succeeded.redirectPath}`),
    pending,
    pendingHeaders,
  );
}
