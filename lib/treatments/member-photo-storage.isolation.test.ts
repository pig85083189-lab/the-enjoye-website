import { describe, expect, it } from "vitest";
import {
  preparePrivateTreatmentPhotos,
  privatePhotoRefsFromMeta,
  privateTreatmentPhotoKey,
  putPrivateTreatmentPhotos,
} from "./member-photo-storage";

const treatmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]).toString("base64");

describe("private treatment photo storage", () => {
  it("rejects traversal, blob payloads, and an upload error", async () => {
    expect(privateTreatmentPhotoKey(treatmentId, "../secret")).toBeNull();
    expect(privateTreatmentPhotoKey("not-a-uuid", "photo-abc-def")).toBeNull();
    expect(preparePrivateTreatmentPhotos([{
      photoId: "photo-abc-def",
      type: "BEFORE",
      bytesBase64: Buffer.from("<svg></svg>").toString("base64"),
    }]).ok).toBe(false);
    const prepared = preparePrivateTreatmentPhotos([{ photoId: "photo-abc-def", type: "BEFORE", bytesBase64: jpeg }]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const failed = await putPrivateTreatmentPhotos(treatmentId, prepared.photos, {
      put: async () => "error",
    });
    expect(failed).toEqual({ ok: false, error: "療程照片上傳失敗，尚未同步。請再次按完成療程，勿另建療程。" });
  });

  it("stores once, treats an existing object as a retry, and returns no storage path", async () => {
    const prepared = preparePrivateTreatmentPhotos([
      { photoId: "photo-left-aaa", type: "BEFORE", bytesBase64: jpeg },
      { photoId: "photo-right-bbb", type: "AFTER", bytesBase64: jpeg },
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const seen: string[] = [];
    const stored = await putPrivateTreatmentPhotos(treatmentId, prepared.photos, {
      put: async (key) => {
        seen.push(key);
        return key.endsWith("photo-right-bbb") ? "exists" : "stored";
      },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(seen).toEqual([
      `${treatmentId}/photo-left-aaa`,
      `${treatmentId}/photo-right-bbb`,
    ]);
    expect(stored.photos).toEqual([
      { photoId: "photo-left-aaa", side: "left", label: "左側", access: "private" },
      { photoId: "photo-right-bbb", side: "right", label: "右側", access: "private" },
    ]);
    expect(JSON.stringify(stored.photos)).not.toMatch(/blob:|storage|supabase|https:/);
  });

  it("refuses to publish a browser preview that was never stored", () => {
    const missing = privatePhotoRefsFromMeta(treatmentId, [{ id: "photo-left-aaa", type: "BEFORE", hadPreview: true }]);
    expect(missing.ok).toBe(false);
    const ready = privatePhotoRefsFromMeta(treatmentId, [{ id: "photo-left-aaa", type: "BEFORE", hadPreview: true, privateObject: true }]);
    expect(ready.ok).toBe(true);
  });
});
