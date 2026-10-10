/**
 * Server-controlled Staff invite redirect.
 * Client-supplied redirectTo is never trusted.
 * Preview and Production Supabase projects cannot share origins.
 */

import { staffAuthCallbackHref } from "@/lib/staff-auth/staff-auth-callback";

export const PRODUCTION_SUPABASE_HOST = "knccefcxncglgpmvgqlp.supabase.co";
export const PREVIEW_SUPABASE_HOST = "bfzquejrtgqzzarhkiya.supabase.co";
export const PRODUCTION_STAFF_ORIGIN = "https://the-enjoye-website.vercel.app";

const PRODUCTION_STAFF_ORIGINS = new Set([
  PRODUCTION_STAFF_ORIGIN,
  "https://the-enjoye-website-pig85083189-6631s-projects.vercel.app",
  "https://the-enjoye-website-git-main-pig85083189-6631s-projects.vercel.app",
]);

export const STAFF_INVITE_CALLBACK_PATH = staffAuthCallbackHref("invite");

export type StaffInviteRedirectResult =
  | { ok: true; origin: string; redirectTo: string }
  | {
      ok: false;
      reason: "unknown_origin" | "cross_environment";
      message: string;
    };

function supabaseHost(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function isProductionSupabaseUrl(url: string | null | undefined): boolean {
  return supabaseHost(url) === PRODUCTION_SUPABASE_HOST;
}

export function isPreviewSupabaseUrl(url: string | null | undefined): boolean {
  return supabaseHost(url) === PREVIEW_SUPABASE_HOST;
}

export function isProductionStaffOrigin(origin: string): boolean {
  return PRODUCTION_STAFF_ORIGINS.has(normalizeOrigin(origin));
}

function previewOriginFromEnv(env: NodeJS.Dict<string>): string | null {
  const explicit = normalizeOrigin(env.STAFF_INVITE_CANONICAL_ORIGIN ?? "");
  if (explicit) {
    if (isProductionStaffOrigin(explicit)) return null;
    if (!explicit.startsWith("https://") && !explicit.startsWith("http://127.0.0.1")) {
      return null;
    }
    return explicit;
  }
  if ((env.VERCEL_ENV ?? "").trim() === "preview") {
    const host = (env.VERCEL_URL ?? "").trim().replace(/^https?:\/\//, "");
    if (!host) return null;
    const origin = `https://${host}`;
    if (isProductionStaffOrigin(origin)) return null;
    return origin;
  }
  if ((env.NODE_ENV ?? "").trim() !== "production") {
    return "http://127.0.0.1:3000";
  }
  return null;
}

export function resolveStaffInviteRedirect(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
  clientRedirectTo?: string | null,
): StaffInviteRedirectResult {
  void clientRedirectTo;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  if (isProductionSupabaseUrl(supabaseUrl)) {
    const redirectTo = `${PRODUCTION_STAFF_ORIGIN}${STAFF_INVITE_CALLBACK_PATH}`;
    return { ok: true, origin: PRODUCTION_STAFF_ORIGIN, redirectTo };
  }

  if (isPreviewSupabaseUrl(supabaseUrl)) {
    if ((env.VERCEL_ENV ?? "").trim() === "production") {
      return {
        ok: false,
        reason: "cross_environment",
        message: "Preview 邀請不得導向 Production",
      };
    }
    const origin = previewOriginFromEnv(env);
    if (!origin) {
      return {
        ok: false,
        reason: "cross_environment",
        message: "Preview 邀請不得導向 Production",
      };
    }
    if (isProductionStaffOrigin(origin)) {
      return {
        ok: false,
        reason: "cross_environment",
        message: "Preview 邀請不得導向 Production",
      };
    }
    return { ok: true, origin, redirectTo: `${origin}${STAFF_INVITE_CALLBACK_PATH}` };
  }

  return {
    ok: false,
    reason: "unknown_origin",
    message: "無法建立安全的邀請導向",
  };
}

export function assertInviteRedirectIsolated(input: {
  supabaseUrl: string;
  origin: string;
}): boolean {
  if (isProductionSupabaseUrl(input.supabaseUrl)) {
    return input.origin === PRODUCTION_STAFF_ORIGIN;
  }
  if (isPreviewSupabaseUrl(input.supabaseUrl)) {
    return !isProductionStaffOrigin(input.origin);
  }
  return false;
}
