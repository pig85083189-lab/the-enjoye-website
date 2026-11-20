/**
 * Member publication may run only when the staff writer and the member reader
 * are the same finance project. The booking project is a different database.
 * This does not change Production environment variables.
 */
export const FINANCE_SUPABASE_ORIGIN = "https://bfzquejrtgqzzarhkiya.supabase.co";
export const BOOKING_SUPABASE_ORIGIN = "https://knccefcxncglgpmvgqlp.supabase.co";

export const PUBLICATION_DATABASE_MISMATCH =
  "正式療程寫入資料庫與會員讀取資料庫不是同一個財務專案，已停止公開，未另建療程。";

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

export function assertPublicationDatabasesAlign(env: NodeJS.Dict<string> = process.env): void {
  if (!publicationDatabasesAlign(env)) throw new Error(PUBLICATION_DATABASE_MISMATCH);
}
