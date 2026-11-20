/**
 * Automatic member publication rules.
 * Insert once. A revoked row is never rewritten. Snapshot equality is canonical.
 * Browser previews and internal storage paths are not member URLs.
 */

export const MEMBER_PHOTO_PUBLIC_HOST = "the-enjoye-website.vercel.app";

export type MemberPhoto = {
  src: string;
  label: string;
  side: "left" | "right" | null;
};

export type ExistingPublication = {
  customer_id: string;
  approved_fields: unknown;
  revoked_at: string | null;
} | null;

type ExpectedPublication = {
  customerId: string;
  fields: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, limit = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

export function canonicalizePublication(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizePublication);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalizePublication(source[key]);
    return out;
  }
  return value;
}

/** Both sides must contain the same keys and values. Extra or stale keys do not match. */
export function publicationSnapshotsMatch(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(canonicalizePublication(expected)) === JSON.stringify(canonicalizePublication(actual));
}

/** https URL on the public site, with no credentials, query, or fragment. */
export function memberSafePhotoUrl(value: unknown): string | null {
  const raw = text(value, 2000);
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:") || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.hostname !== MEMBER_PHOTO_PUBLIC_HOST) return null;
  if (url.pathname.includes("..") || url.pathname.includes("\\")) return null;
  return url.toString();
}

function photoSide(value: unknown): MemberPhoto["side"] {
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "before" || raw === "left" || raw === "左側") return "left";
  if (raw === "after" || raw === "right" || raw === "右側") return "right";
  return null;
}

function photoRank(side: MemberPhoto["side"]): number {
  if (side === "left") return 0;
  if (side === "right") return 1;
  return 2;
}

/**
 * photo_meta stores id/type/hadPreview only. treatment_photos.storage_path is an
 * internal object key. Neither is a URL a member browser can fetch.
 */
export function memberVisiblePhotos(raw: unknown): MemberPhoto[] {
  if (!Array.isArray(raw)) return [];
  const photos: MemberPhoto[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 24)) {
    const row = asObject(item);
    const src = memberSafePhotoUrl(row.src ?? row.url ?? row.publicUrl ?? row.href ?? row.storage_path);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const side = photoSide(row.side ?? row.photo_type ?? row.type ?? row.label);
    photos.push({
      src,
      label: text(row.label) ?? (side === "left" ? "左側" : side === "right" ? "右側" : "療程照片"),
      side,
    });
    if (photos.length >= 12) break;
  }
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => photoRank(a.photo.side) - photoRank(b.photo.side) || a.index - b.index)
    .map((item) => item.photo);
}

export function classifyExistingPublication(
  existing: ExistingPublication,
  expected: ExpectedPublication,
): "absent" | "revoked" | "already" | "mismatch" {
  if (!existing) return "absent";
  if (existing.revoked_at) return "revoked";
  if (existing.customer_id !== expected.customerId) return "mismatch";
  if (!publicationSnapshotsMatch(expected.fields, existing.approved_fields)) return "mismatch";
  return "already";
}

const REVOKED = "此療程已撤銷會員公開，無法自動重新公開";
const MISMATCH = "療程已完成，但既有會員公開紀錄與最新內容不一致，請聯絡管理員確認，勿重複建立療程";
const FAILED = "療程已儲存，但會員身體紀錄公開失敗。請再次按完成療程補公開，勿另建療程。";
const UNVERIFIED = "療程已儲存，但會員公開資料回讀驗證失敗。請再次按完成療程補公開，勿另建療程。";

/**
 * Read, then insert. A unique conflict is re-read and never updated.
 * A revocation that wins the race stays revoked.
 */
export async function commitAutomaticPublication(input: {
  read: () => Promise<ExistingPublication>;
  insert: () => Promise<"ok" | "conflict" | "error">;
  customerId: string;
  fields: Record<string, unknown>;
}): Promise<"inserted" | "already"> {
  const expected = { customerId: input.customerId, fields: input.fields };
  const current = classifyExistingPublication(await input.read(), expected);
  if (current === "revoked") throw new Error(REVOKED);
  if (current === "mismatch") throw new Error(MISMATCH);
  if (current === "already") return "already";
  const inserted = await input.insert();
  if (inserted === "error") throw new Error(FAILED);
  const verified = classifyExistingPublication(await input.read(), expected);
  if (verified === "revoked") throw new Error(REVOKED);
  if (verified !== "already") throw new Error(UNVERIFIED);
  return inserted === "conflict" ? "already" : "inserted";
}
