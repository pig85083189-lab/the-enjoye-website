/**
 * Beauty OS keeps writing through its booking connection.
 * Member publication is readable only on the finance project.
 * When those are different projects, the server copies one member snapshot
 * onto finance. It does not retarget NEXT_PUBLIC_SUPABASE_URL.
 */
export const FINANCE_SUPABASE_ORIGIN = "https://bfzquejrtgqzzarhkiya.supabase.co";
export const BOOKING_SUPABASE_ORIGIN = "https://knccefcxncglgpmvgqlp.supabase.co";

export const PUBLICATION_DATABASE_MISMATCH =
  "正式療程寫入資料庫與會員讀取資料庫不是已核對的預約／財務組合，已停止公開，未另建療程。";

export function canonicalSupabaseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      return null;
    }
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export type PublicationDatabaseKind = "finance" | "booking" | "other" | "missing";

export function publicationDatabaseKind(value: string | undefined): PublicationDatabaseKind {
  const origin = canonicalSupabaseOrigin(value);
  if (!origin) return "missing";
  if (origin === FINANCE_SUPABASE_ORIGIN) return "finance";
  if (origin === BOOKING_SUPABASE_ORIGIN) return "booking";
  return "other";
}

/** Writer is the browser/service-role URL. Reader is the member server URL. */
export function publicationDatabasesAlign(env: NodeJS.Dict<string> = process.env): boolean {
  return publicationDatabaseKind(env.NEXT_PUBLIC_SUPABASE_URL) === "finance"
    && publicationDatabaseKind(env.BEAUTY_OS_SUPABASE_URL) === "finance";
}

export type MemberPublicationSyncMode = "same-finance" | "booking-to-finance";

/**
 * same-finance: the completed treatment already lives where the member reads.
 * booking-to-finance: keep the booking writer and copy one snapshot to finance.
 * Any other combination, including both URLs pointing at booking, is refused.
 */
export function memberPublicationSyncMode(
  env: NodeJS.Dict<string> = process.env,
): MemberPublicationSyncMode | null {
  const writer = publicationDatabaseKind(env.NEXT_PUBLIC_SUPABASE_URL);
  const reader = publicationDatabaseKind(env.BEAUTY_OS_SUPABASE_URL);
  if (writer === "finance" && reader === "finance") return "same-finance";
  if (writer === "booking" && reader === "finance") return "booking-to-finance";
  return null;
}

export function assertMemberPublicationTarget(
  env: NodeJS.Dict<string> = process.env,
): MemberPublicationSyncMode {
  const mode = memberPublicationSyncMode(env);
  if (!mode) throw new Error(PUBLICATION_DATABASE_MISMATCH);
  return mode;
}
