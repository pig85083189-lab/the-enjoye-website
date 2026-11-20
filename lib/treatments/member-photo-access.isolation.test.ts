import { describe, expect, it } from "vitest";
import { authorizePrivatePhotoRead, classifyStoredTreatmentPhoto } from "./member-photo-access";

describe("treatment photo publication", () => {
  it("does not treat a browser preview or hadPreview flag as a member photo", () => {
    expect(classifyStoredTreatmentPhoto({
      previewUrl: "blob:https://the-enjoye-website.vercel.app/8c0c5c2e-1b2a-4d3e-9f00-aaaaaaaaaaaa",
    })).toEqual({ kind: "browser-preview", publishable: false });
    expect(classifyStoredTreatmentPhoto({ hadPreview: true })).toEqual({ kind: "browser-preview", publishable: false });
    expect(classifyStoredTreatmentPhoto({
      storagePath: "org/customer/treatment/left.jpg",
    })).toEqual({ kind: "private-object", publishable: false });
  });

  it("keeps an ordinary public https URL publishable", () => {
    expect(classifyStoredTreatmentPhoto({
      url: "https://the-enjoye-website.vercel.app/left.jpg",
    })).toEqual({
      kind: "public-https",
      publishable: true,
      src: "https://the-enjoye-website.vercel.app/left.jpg",
    });
  });

  it("allows a private object only for the member who owns the publication", () => {
    expect(authorizePrivatePhotoRead({
      viewerCustomerId: "member-1",
      treatmentCustomerId: "member-1",
      publicationRevoked: false,
    })).toBe("allow");
    expect(authorizePrivatePhotoRead({
      viewerCustomerId: "member-2",
      treatmentCustomerId: "member-1",
      publicationRevoked: false,
    })).toBe("deny");
    expect(authorizePrivatePhotoRead({
      viewerCustomerId: "member-1",
      treatmentCustomerId: "member-1",
      publicationRevoked: true,
    })).toBe("deny");
  });
});
