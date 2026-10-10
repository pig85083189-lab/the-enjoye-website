import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import {
  applyAuthCookiesToRedirect,
  cookieNamesIncludePkceVerifier,
  isStaffAuthCallbackPath,
  parseStaffAuthCallbackFlow,
  resolveStaffAuthCallbackDecision,
  staffAuthCallbackHref,
  staffSetupPasswordLinkErrorCopy,
} from "@/lib/staff-auth/staff-auth-callback";
import {
  evaluateStaffPasswordSetup,
  passwordSetupMustNotClaimMembership,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_SUPABASE_HOST,
  resolveStaffInviteRedirect,
  STAFF_INVITE_CALLBACK_PATH,
} from "@/lib/staff-auth/staff-invite-redirect";
import {
  STAFF_SETUP_PASSWORD_HREF,
  STAFF_TODAY_HREF,
} from "@/lib/staff-auth/staff-invite-gate";
import {
  STAFF_SUPABASE_COOKIE_ENCODING,
  STAFF_SUPABASE_COOKIE_OPTIONS,
} from "@/lib/supabase/auth-cookie-options";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("staff recovery PKCE callback", () => {
  it("exchanges a recovery code and keeps session cookies on the redirect", () => {
    const decision = resolveStaffAuthCallbackDecision({
      hasCode: true,
      envConfigured: true,
      hasPkceVerifierCookie: true,
      flow: "recovery",
      requestedNext: STAFF_SETUP_PASSWORD_HREF,
      exchangeError: false,
      gate: "ok",
      authenticated: true,
    });
    expect(decision.exchange).toBe(true);
    expect(decision.applySetCookies).toBe(true);
    expect(decision.redirectPath).toBe(
      `${STAFF_SETUP_PASSWORD_HREF}?flow=recovery`,
    );
    expect(decision.redirectPath).not.toMatch(/error=/);
    expect(decision.redirectPath).not.toMatch(/code=/);

    const redirect = applyAuthCookiesToRedirect(
      NextResponse.redirect("https://preview.example/staff/auth/setup-password"),
      [{ name: "sb-preview-auth-token", value: "session-placeholder" }],
      { "Cache-Control": "private, no-store" },
    );
    expect(redirect.cookies.get("sb-preview-auth-token")?.value).toBe(
      "session-placeholder",
    );
    expect(redirect.headers.get("Cache-Control")).toBe("private, no-store");

    const callback = source("app/staff/auth/callback/route.ts");
    expect(callback).toMatch(/exchangeCodeForSession/);
    expect(callback).toMatch(/applyAuthCookiesToRedirect/);
    expect(callback).toMatch(/cookieNamesIncludePkceVerifier/);
    expect(callback).not.toMatch(/console\.(log|info|debug|error|warn)/);
    expect(callback).not.toMatch(/code_verifier/);
    expect(callback).not.toMatch(/localStorage/);
  });

  it("fails closed when the PKCE verifier cookie is missing", () => {
    const decision = resolveStaffAuthCallbackDecision({
      hasCode: true,
      envConfigured: true,
      hasPkceVerifierCookie: false,
      flow: "recovery",
      requestedNext: STAFF_SETUP_PASSWORD_HREF,
      exchangeError: null,
      gate: "login",
      authenticated: false,
    });
    expect(decision.exchange).toBe(false);
    expect(decision.applySetCookies).toBe(false);
    expect(decision.redirectPath).toBe(
      `${STAFF_SETUP_PASSWORD_HREF}?error=expired&flow=recovery`,
    );
    expect(
      cookieNamesIncludePkceVerifier([
        { name: "sb-preview-auth-token" },
      ]),
    ).toBe(false);
    expect(
      cookieNamesIncludePkceVerifier([
        { name: "sb-preview-auth-token-code-verifier" },
      ]),
    ).toBe(true);
  });

  it("shows recovery copy instead of invite expiry on forgot-password failure", () => {
    const recovery = staffSetupPasswordLinkErrorCopy({
      error: "expired",
      flow: "recovery",
    });
    expect(recovery?.flow).toBe("recovery");
    expect(recovery?.description).toMatch(/忘記密碼/);
    expect(recovery?.description).not.toMatch(/邀請信件/);
    expect(source("app/staff/auth/forgot-password/page.tsx")).toMatch(
      /staffAuthCallbackHref\("recovery"\)/,
    );
    expect(source("app/staff/auth/setup-password/page.tsx")).toMatch(
      /staffSetupPasswordLinkErrorCopy/,
    );
  });

  it("keeps invite expiry copy for invite callback failures", () => {
    const invite = staffSetupPasswordLinkErrorCopy({
      error: "expired",
      flow: "invite",
    });
    expect(invite?.flow).toBe("invite");
    expect(invite?.description).toMatch(/邀請信件連結已過期/);
    expect(STAFF_INVITE_CALLBACK_PATH).toContain("flow=invite");
    expect(parseStaffAuthCallbackFlow(null)).toBe("invite");
  });

  it("does not claim membership for a bound STAFF recovery", () => {
    expect(
      evaluateStaffPasswordSetup({
        authenticated: true,
        boundActiveMembership: true,
        pendingInviteForAuthUser: true,
      }),
    ).toBe("recovery");
    expect(passwordSetupMustNotClaimMembership("recovery")).toBe(true);
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/if \(intent === "recovery"\)/);
    expect(
      actions.indexOf("if (intent === \"recovery\")"),
    ).toBeLessThan(actions.lastIndexOf("acceptStaffInviteAction()"));
  });

  it("does not let an unauthenticated visitor change a password", () => {
    expect(
      evaluateStaffPasswordSetup({
        authenticated: false,
        boundActiveMembership: false,
        pendingInviteForAuthUser: false,
      }),
    ).toBe("login");
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(setup.indexOf("getUser()")).toBeLessThan(setup.indexOf("updateUser"));
    expect(setup).toMatch(/尚未登入，無法設定密碼/);
    expect(source("lib/staff-auth/actions.ts")).toMatch(/intent: "login"/);
  });

  it("keeps Preview recovery and invite redirects off Production", () => {
    expect(staffAuthCallbackHref("recovery")).toContain("flow=recovery");
    const preview = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "preview",
      VERCEL_URL: "the-enjoye-website-preview-1.vercel.app",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.origin).not.toBe(PRODUCTION_STAFF_ORIGIN);
      expect(preview.redirectTo).toContain(STAFF_INVITE_CALLBACK_PATH);
    }
    const leaked = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "production",
      VERCEL_URL: "the-enjoye-website.vercel.app",
    });
    expect(leaked.ok).toBe(false);
    const production = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
    });
    expect(production).toMatchObject({
      ok: true,
      origin: PRODUCTION_STAFF_ORIGIN,
    });
  });

  it("uses matching PKCE cookie settings and skips proxy getUser on callback", () => {
    expect(STAFF_SUPABASE_COOKIE_ENCODING).toBe("base64url");
    expect(STAFF_SUPABASE_COOKIE_OPTIONS).toMatchObject({
      path: "/",
      sameSite: "lax",
    });
    expect(isStaffAuthCallbackPath("/staff/auth/callback")).toBe(true);
    expect(isStaffAuthCallbackPath("/staff/auth/setup-password")).toBe(false);
    expect(source("lib/supabase/client.ts")).toMatch(/STAFF_SUPABASE_COOKIE_ENCODING/);
    expect(source("lib/supabase/server.ts")).toMatch(/STAFF_SUPABASE_COOKIE_ENCODING/);
    expect(source("lib/supabase/proxy.ts")).toMatch(/isStaffAuthCallbackPath/);
    expect(source("app/staff/auth/callback/route.ts")).toMatch(
      /STAFF_SUPABASE_COOKIE_ENCODING/,
    );
    expect(existsSync(path.join(ROOT, "lib/supabase/auth-cookie-options.ts"))).toBe(
      true,
    );
    const boundSuccess = resolveStaffAuthCallbackDecision({
      hasCode: true,
      envConfigured: true,
      hasPkceVerifierCookie: true,
      flow: "recovery",
      requestedNext: STAFF_TODAY_HREF,
      exchangeError: false,
      gate: "ok",
      authenticated: true,
    });
    expect(boundSuccess.redirectPath).toBe(STAFF_TODAY_HREF);
    const cookiesPending = resolveStaffAuthCallbackDecision({
      hasCode: true,
      envConfigured: true,
      hasPkceVerifierCookie: true,
      flow: "recovery",
      requestedNext: STAFF_SETUP_PASSWORD_HREF,
      exchangeError: false,
      gate: "login",
      authenticated: false,
    });
    expect(cookiesPending.applySetCookies).toBe(true);
    expect(cookiesPending.redirectPath).toBe(
      `${STAFF_SETUP_PASSWORD_HREF}?flow=recovery`,
    );
    expect(cookiesPending.redirectPath).not.toMatch(/error=/);
  });
});
