/**
 * Treatment photos are not member images until a private object exists
 * and the verified member owns the publication.
 * Browser blob previews and hadPreview metadata are never official photos.
 */

import { memberSafePhotoUrl } from "@/lib/treatments/member-publication-guard";

export type StoredPhotoDecision =
  | { kind: "browser-preview"; publishable: false }
  | { kind: "private-object"; publishable: false }
  | { kind: "public-https"; publishable: true; src: string }
  | { kind: "rejected"; publishable: false };

export function classifyStoredTreatmentPhoto(photo: {
  previewUrl?: unknown;
  src?: unknown;
  url?: unknown;
  storagePath?: unknown;
  hadPreview?: unknown;
}): StoredPhotoDecision {
  const preview = typeof photo.previewUrl === "string" ? photo.previewUrl : "";
  if (preview.startsWith("blob:") || preview.startsWith("data:")) return { kind: "browser-preview", publishable: false };
  const direct = memberSafePhotoUrl(photo.src ?? photo.url);
  if (direct) return { kind: "public-https", publishable: true, src: direct };
  if (typeof photo.storagePath === "string" && photo.storagePath.trim() && !photo.storagePath.includes("://")) {
    return { kind: "private-object", publishable: false };
  }
  if (photo.hadPreview === true) return { kind: "browser-preview", publishable: false };
  return { kind: "rejected", publishable: false };
}

/** A private object may be read only for the member who owns the non-revoked publication. */
export function authorizePrivatePhotoRead(input: {
  viewerCustomerId: string;
  treatmentCustomerId: string;
  publicationRevoked: boolean;
}): "allow" | "deny" {
  if (input.publicationRevoked) return "deny";
  if (!input.viewerCustomerId || input.viewerCustomerId !== input.treatmentCustomerId) return "deny";
  return "allow";
}
