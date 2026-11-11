import { staffAuthCallbackHref } from "@/lib/staff-auth/staff-auth-callback";
import {
  isPreviewSupabaseUrl,
  isProductionSupabaseUrl,
  isProductionStaffOrigin,
  PRODUCTION_STAFF_ORIGIN,
} from "@/lib/staff-auth/staff-invite-redirect";

export type StaffRecoveryRedirect =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: "invalid_origin" | "cross_environment" };

export function resolveStaffRecoveryRedirect(input: {
  supabaseUrl: string | null | undefined;
  browserOrigin: string;
}): StaffRecoveryRedirect {
  let origin: string;
  try {
    const parsed = new URL(input.browserOrigin);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return { ok: false, reason: "invalid_origin" };
    }
    origin = parsed.origin;
  } catch {
    return { ok: false, reason: "invalid_origin" };
  }

  if (isProductionSupabaseUrl(input.supabaseUrl)) {
    if (origin !== PRODUCTION_STAFF_ORIGIN) {
      return { ok: false, reason: "cross_environment" };
    }
    return { ok: true, redirectTo: PRODUCTION_STAFF_ORIGIN + staffAuthCallbackHref("recovery") };
  }
  if (isPreviewSupabaseUrl(input.supabaseUrl)) {
    if (isProductionStaffOrigin(origin) || !(
      origin.startsWith("https://") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("http://localhost:")
    )) {
      return { ok: false, reason: "cross_environment" };
    }
    return { ok: true, redirectTo: origin + staffAuthCallbackHref("recovery") };
  }
  return { ok: false, reason: "cross_environment" };
}
