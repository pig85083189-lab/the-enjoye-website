/**
 * Private treatment photos. The object key stays on the server.
 * Publications store an opaque photo id, never a blob URL or storage path.
 */

export const MEMBER_TREATMENT_PHOTO_BUCKET = "member-treatment-photos";

const PHOTO_ID = /^photo-[a-z0-9]+-[a-z0-9]+$/;
const TREATMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 1_500_000;
const MAX_PHOTOS = 8;

export type PrivatePhotoRef = {
  photoId: string;
  side: "left" | "right";
  label: string;
  access: "private";
};

export type PreparedTreatmentPhoto = {
  photoId: string;
  type: "BEFORE" | "AFTER";
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
};

export function privateTreatmentPhotoKey(treatmentId: string, photoId: string): string | null {
  if (!TREATMENT_ID.test(treatmentId) || !PHOTO_ID.test(photoId)) return null;
  if (treatmentId.includes("/") || photoId.includes("/") || treatmentId.includes("..") || photoId.includes("..")) return null;
  return `${treatmentId}/${photoId}`;
}

export function sniffImageType(bytes: Uint8Array): PreparedTreatmentPhoto["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export function preparePrivateTreatmentPhotos(uploads: unknown): { ok: true; photos: PreparedTreatmentPhoto[] } | { ok: false; error: string } {
  if (!Array.isArray(uploads)) return { ok: false, error: "療程照片格式無效，尚未同步。" };
  if (uploads.length > MAX_PHOTOS) return { ok: false, error: "療程照片超過可同步數量，尚未同步。" };
  const photos: PreparedTreatmentPhoto[] = [];
  const seen = new Set<string>();
  for (const item of uploads) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const photoId = typeof row.photoId === "string" ? row.photoId : "";
    const type = row.type === "AFTER" ? "AFTER" : row.type === "BEFORE" ? "BEFORE" : null;
    if (!PHOTO_ID.test(photoId) || !type || seen.has(photoId)) return { ok: false, error: "療程照片編號無效，尚未同步。" };
    const raw = typeof row.bytesBase64 === "string" ? row.bytesBase64 : "";
    if (!raw || raw.length > MAX_BYTES * 2) return { ok: false, error: "療程照片過大或是空檔，尚未同步。" };
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(raw, "base64"));
    } catch {
      return { ok: false, error: "療程照片內容無法讀取，尚未同步。" };
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return { ok: false, error: "療程照片過大或是空檔，尚未同步。" };
    const contentType = sniffImageType(bytes);
    if (!contentType) return { ok: false, error: "療程照片必須是 JPEG、PNG 或 WebP，尚未同步。" };
    seen.add(photoId);
    photos.push({ photoId, type, contentType, bytes });
  }
  return { ok: true, photos };
}

export function privatePhotoRefsFromMeta(
  treatmentId: string,
  photoMeta: unknown,
): { ok: true; photos: PrivatePhotoRef[] } | { ok: false; error: string } {
  if (!Array.isArray(photoMeta) || photoMeta.length === 0) return { ok: true, photos: [] };
  const photos: PrivatePhotoRef[] = [];
  for (const item of photoMeta) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (row.hadPreview !== true) continue;
    if (row.privateObject !== true) {
      return { ok: false, error: "療程照片尚未寫入私人儲存，會員同步已停止。請重新加入照片後再按完成，勿另建療程。" };
    }
    const photoId = typeof row.id === "string" ? row.id : "";
    const type = row.type === "AFTER" ? "AFTER" : row.type === "BEFORE" ? "BEFORE" : null;
    if (!type || !privateTreatmentPhotoKey(treatmentId, photoId)) {
      return { ok: false, error: "療程照片編號無效，會員同步已停止。" };
    }
    photos.push(privatePhotoRef({ photoId, type }));
  }
  return { ok: true, photos };
}

export function privatePhotoRef(photo: { photoId: string; type: "BEFORE" | "AFTER" }): PrivatePhotoRef {
  const side = photo.type === "BEFORE" ? "left" : "right";
  return { photoId: photo.photoId, side, label: side === "left" ? "左側" : "右側", access: "private" };
}

export async function confirmPrivateTreatmentPhotos(
  treatmentId: string,
  photos: readonly PrivatePhotoRef[],
  storage: { stat(key: string): Promise<"present" | "missing" | "error"> },
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const photo of photos) {
    const key = privateTreatmentPhotoKey(treatmentId, photo.photoId);
    if (!key) return { ok: false, error: "療程照片編號無效，會員同步已停止。" };
    const state = await storage.stat(key);
    if (state !== "present") return { ok: false, error: "療程照片無法確認，會員同步已停止。請再次按完成療程補同步，勿另建療程。" };
  }
  return { ok: true };
}

export async function putPrivateTreatmentPhotos(
  treatmentId: string,
  photos: readonly PreparedTreatmentPhoto[],
  storage: { put(key: string, bytes: Uint8Array, contentType: string): Promise<"stored" | "exists" | "error"> },
): Promise<{ ok: true; photos: PrivatePhotoRef[] } | { ok: false; error: string }> {
  const refs: PrivatePhotoRef[] = [];
  for (const photo of photos) {
    const key = privateTreatmentPhotoKey(treatmentId, photo.photoId);
    if (!key) return { ok: false, error: "療程照片編號無效，尚未同步。" };
    const result = await storage.put(key, photo.bytes, photo.contentType);
    if (result === "error") return { ok: false, error: "療程照片上傳失敗，尚未同步。請再次按完成療程，勿另建療程。" };
    refs.push(privatePhotoRef(photo));
  }
  return { ok: true, photos: refs };
}
