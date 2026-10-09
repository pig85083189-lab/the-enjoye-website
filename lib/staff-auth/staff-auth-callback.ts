import { NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import {
  resolveStaffAuthCallbackNext,
  STAFF_SETUP_PASSWORD_HREF,
  type StaffSessionGate,
} from "@/lib/staff-auth/staff-invite-gate";
import { staffInviteAuthLinkExpiredMessage } from "@/lib/staff-auth/staff-invite-reconciliation";

export type StaffAuthCallbackFlow = "recovery" | "invite";

export const STAFF_AUTH_CALLBACK_FLOW_PARAM = "flow";

export type AuthCookieToSet = {
  name: string;
  value: string;
  options?: CookieOptions;
};

export type StaffAuthCallbackDecision = {
  exchange: boolean;
  redirectPath: string;
  applySetCookies: boolean;
};

export function isStaffAuthCallbackPath(pathname: string): boolean {
  return pathname === "/staff/auth/callback";
}

export function parseStaffAuthCallbackFlow(
  value: string | null | undefined,
): StaffAuthCallbackFlow {
  return value === "recovery" ? "recovery" : "invite";
}

export function staffAuthCallbackHref(flow: StaffAuthCallbackFlow): string {
  return `/staff/auth/callback?next=/staff/auth/setup-password&${STAFF_AUTH_CALLBACK_FLOW_PARAM}=${flow}`;
}

export function cookieNamesIncludePkceVerifier(
  cookies: Array<{ name: string }>,
): boolean {
  return cookies.some((cookie) => cookie.name.includes("-code-verifier"));
}

export function staffAuthCallbackFailurePath(
  flow: StaffAuthCallbackFlow,
  reason: "invalid" | "expired",
): string {
  return withCallbackFlow(`${STAFF_SETUP_PASSWORD_HREF}?error=${reason}`, flow);
}

export function staffSetupPasswordLinkErrorCopy(input: {
  error: string | null;
  flow: string | null;
}): {
  title: string;
  description: string;
  hint: string;
  flow: StaffAuthCallbackFlow;
} | null {
  if (input.error !== "invalid" && input.error !== "expired") return null;
  const flow = parseStaffAuthCallbackFlow(input.flow);
  if (flow === "recovery") {
    return {
      flow,
      title: "這個連結已失效",
      description:
        "重設密碼連結已過期或已使用。請回到登入頁，再次使用忘記密碼取得新連結。",
      hint: "請使用同一個瀏覽器開啟信件連結。",
    };
  }
  return {
    flow,
    title: "這個連結已失效",
    description: staffInviteAuthLinkExpiredMessage(),
    hint: "請聯絡店長重新取得邀請，或到登入頁使用忘記密碼。",
  };
}

export function resolveStaffAuthCallbackDecision(input: {
  hasCode: boolean;
  envConfigured: boolean;
  hasPkceVerifierCookie: boolean;
  flow: string | null;
  requestedNext: string;
  exchangeError: boolean | null;
  gate: StaffSessionGate;
  authenticated: boolean;
}): StaffAuthCallbackDecision {
  const flow = parseStaffAuthCallbackFlow(input.flow);
  if (!input.hasCode || !input.envConfigured) {
    return {
      exchange: false,
      redirectPath: staffAuthCallbackFailurePath(flow, "invalid"),
      applySetCookies: false,
    };
  }
  if (!input.hasPkceVerifierCookie) {
    return {
      exchange: false,
      redirectPath: staffAuthCallbackFailurePath(flow, "expired"),
      applySetCookies: false,
    };
  }
  if (input.exchangeError === null) {
    return {
      exchange: true,
      redirectPath: "",
      applySetCookies: false,
    };
  }
  if (input.exchangeError) {
    return {
      exchange: true,
      redirectPath: staffAuthCallbackFailurePath(flow, "expired"),
      applySetCookies: true,
    };
  }

  let redirectPath = resolveStaffAuthCallbackNext({
    gate: input.gate,
    requestedNext: input.requestedNext,
  });
  if (
    !input.authenticated &&
    input.requestedNext === STAFF_SETUP_PASSWORD_HREF
  ) {
    redirectPath = STAFF_SETUP_PASSWORD_HREF;
  }
  return {
    exchange: true,
    redirectPath: withCallbackFlow(redirectPath, flow),
    applySetCookies: true,
  };
}

export function applyAuthCookiesToRedirect(
  response: NextResponse,
  cookiesToSet: AuthCookieToSet[],
  headers?: Record<string, string>,
): NextResponse {
  for (const cookie of cookiesToSet) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
  }
  return response;
}

function withCallbackFlow(path: string, flow: StaffAuthCallbackFlow): string {
  if (!path.startsWith(STAFF_SETUP_PASSWORD_HREF)) return path;
  const [pathname, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set(STAFF_AUTH_CALLBACK_FLOW_PARAM, flow);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
