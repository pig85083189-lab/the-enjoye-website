"use server";

import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { memberSyncCustomerAllowed } from "@/lib/treatments/member-sync-allowlist";
import {
  MEMBER_TREATMENT_PHOTO_BUCKET,
  preparePrivateTreatmentPhotos,
  privateTreatmentPhotoKey,
  putPrivateTreatmentPhotos,
} from "@/lib/treatments/member-photo-storage";

const allowedRoles = new Set(["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]);

function uploadState(error: { message?: string; statusCode?: string | number } | null): "stored" | "exists" | "error" {
  if (!error) return "stored";
  const message = error.message?.toLowerCase() ?? "";
  if (String(error.statusCode ?? "") === "409" || message.includes("already exists") || message.includes("duplicate")) return "exists";
  return "error";
}

/** Store image bytes before the treatment row becomes immutable. A failure writes no publication. */
export async function storeMemberTreatmentPhotos(
  organizationId: string,
  treatmentId: string,
  uploads: unknown,
): Promise<{ ok: true }> {
  if (!organizationId || organizationId.length > 160 || !treatmentId || treatmentId.length > 160) {
    throw new Error("無效的療程資料");
  }
  const prepared = preparePrivateTreatmentPhotos(uploads);
  if (!prepared.ok) throw new Error(prepared.error);
  if (!prepared.photos.length) return { ok: true };
  const auth = await getAuthenticatedStaffMembership({ organizationId });
  if (auth.status !== "ok" || !allowedRoles.has(auth.membership.role)) throw new Error("沒有權限儲存療程照片");
  const db = createServiceRoleClient();
  const finance = createBeautyOsFinanceClient();
  if (!db || !finance) throw new Error("會員照片儲存尚未設定，尚未同步。");
  const org = await db.from("organizations").select("id").eq("app_id", organizationId).maybeSingle();
  if (org.error || !org.data) throw new Error("找不到此店家的正式資料，尚未同步。");
  const matches = await db.from("treatments").select("id,customer_id,status")
    .eq("app_id", treatmentId).eq("organization_id", org.data.id).limit(2);
  const treatment = matches.data?.length === 1 ? matches.data[0] : null;
  if (matches.error || !treatment || (treatment.status !== "DRAFT" && treatment.status !== "COMPLETED")) {
    throw new Error("找不到可附加照片的療程，尚未同步。");
  }
  if (!memberSyncCustomerAllowed(treatment.customer_id)) throw new Error("這位顧客不在會員同步允許名單，未公開給任何會員。");
  const stored = await putPrivateTreatmentPhotos(treatment.id, prepared.photos, {
    async put(key, bytes, contentType) {
      const result = await finance.storage.from(MEMBER_TREATMENT_PHOTO_BUCKET).upload(key, Buffer.from(bytes), {
        contentType,
        upsert: false,
      });
      return uploadState(result.error);
    },
  });
  if (!stored.ok) throw new Error(stored.error);
  if (stored.photos.some((photo) => !privateTreatmentPhotoKey(treatment.id, photo.photoId))) {
    throw new Error("療程照片編號無效，尚未同步。");
  }
  return { ok: true };
}
