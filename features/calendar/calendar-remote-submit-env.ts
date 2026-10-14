/**
 * Browser calendar submit env. Client bundles do not spread process.env;
 * NEXT_PUBLIC_* must be read as a direct property so Next can inline it.
 * Persist still requires the Preview Supabase host and never opens on
 * Production.
 */

import { LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV } from "@/lib/line/automations/appointment-reminder-flag";
import { LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST } from "@/lib/line/line-flag";

function reminderSupabaseHostname(env: NodeJS.Dict<string>): string | null {
  const raw = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export function calendarRemoteSubmitEnv(
  extra: NodeJS.Dict<string> = {},
  base: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): NodeJS.Dict<string> {
  const env: NodeJS.Dict<string> = {
    ...base,
    NEXT_PUBLIC_SUPABASE_URL:
      extra.NEXT_PUBLIC_SUPABASE_URL ??
      base.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ...extra,
  };
  if ((env.VERCEL_ENV ?? "").trim() === "production") return env;
  if (reminderSupabaseHostname(env) !== LINE_BROADCAST_ONESHOT_PREVIEW_SUPABASE_HOST) {
    return env;
  }
  if (!(env.VERCEL_ENV ?? "").trim()) env.VERCEL_ENV = "preview";
  if (!(env[LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV] ?? "").trim()) {
    env[LINE_APPOINTMENT_REMINDER_PERSIST_OPEN_ENV] = "1";
  }
  return env;
}
