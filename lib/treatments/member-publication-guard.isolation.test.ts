import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyExistingPublication,
  commitAutomaticPublication,
  memberSafePhotoUrl,
  memberVisiblePhotos,
  publicationSnapshotsMatch,
} from "./member-publication-guard";
import {
  BOOKING_SUPABASE_ORIGIN,
  FINANCE_SUPABASE_ORIGIN,
  publicationDatabasesAlign,
} from "./publication-database";

const fields = { professional_note: "有改善", photos: [{ src: "https://the-enjoye-website.vercel.app/left.jpg", label: "左側", side: "left" }] };

describe("member publication snapshot", () => {
  it("treats extra or stale keys as a different snapshot", () => {
    expect(publicationSnapshotsMatch(fields, { photos: fields.photos, professional_note: "有改善" })).toBe(true);
    expect(publicationSnapshotsMatch(fields, { ...fields, stale: "舊欄位" })).toBe(false);
    expect(publicationSnapshotsMatch(fields, { professional_note: "有改善" })).toBe(false);
  });

  it("publishes only public https photos and orders left before right", () => {
    expect(memberSafePhotoUrl("blob:https://the-enjoye-website.vercel.app/abc")).toBeNull();
    expect(memberSafePhotoUrl("data:image/png;base64,aaaa")).toBeNull();
    expect(memberSafePhotoUrl("org/customer/private.jpg")).toBeNull();
    expect(memberSafePhotoUrl("https://the-enjoye-website.vercel.app/left.jpg?token=secret")).toBeNull();
    const photos = memberVisiblePhotos([
      { id: "meta-1", type: "BEFORE", hadPreview: true },
      { storage_path: "treatments/private/after.jpg", photo_type: "AFTER" },
      { url: "https://cdn.example.com/right.jpg", side: "right" },
      { url: "https://the-enjoye-website.vercel.app/right.jpg", side: "right", label: "右側" },
      { url: "https://the-enjoye-website.vercel.app/left.jpg", type: "BEFORE", label: "左側" },
    ]);
    expect(photos.map((photo) => photo.side)).toEqual(["left", "right"]);
    expect(photos.map((photo) => photo.src)).toEqual([
      "https://the-enjoye-website.vercel.app/left.jpg",
      "https://the-enjoye-website.vercel.app/right.jpg",
    ]);
  });
});

describe("automatic publication commit", () => {
  const row = { customer_id: "customer-1", approved_fields: fields, revoked_at: null };

  it("inserts when no publication exists and verifies the readback", async () => {
    let stored: typeof row | null = null;
    const result = await commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => stored,
      insert: async () => {
        stored = row;
        return "ok";
      },
    });
    expect(result).toBe("inserted");
  });

  it("retries an identical publication without inserting again", async () => {
    let inserts = 0;
    const result = await commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => row,
      insert: async () => {
        inserts += 1;
        return "ok";
      },
    });
    expect(result).toBe("already");
    expect(inserts).toBe(0);
  });

  it("does not report success when the insert fails after the treatment is already completed", async () => {
    await expect(commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => null,
      insert: async () => "error",
    })).rejects.toThrow("請再次按完成療程補公開，勿另建療程");
  });

  it("keeps a revocation that wins the race and does not rewrite the row", async () => {
    const writes: string[] = [];
    let stored: typeof row | { revoked_at: string } | null = null;
    await expect(commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => stored as typeof row | null,
      insert: async () => {
        writes.push("insert");
        stored = { ...row, revoked_at: "2026-11-20T00:00:00.000Z" };
        return "conflict";
      },
    })).rejects.toThrow("無法自動重新公開");
    expect(writes).toEqual(["insert"]);
    expect(classifyExistingPublication(stored, { customerId: "customer-1", fields })).toBe("revoked");
  });

  it("rejects an existing snapshot with an extra key", () => {
    expect(classifyExistingPublication(
      { customer_id: "customer-1", approved_fields: { ...fields, stale: true }, revoked_at: null },
      { customerId: "customer-1", fields },
    )).toBe("mismatch");
  });
});

describe("publication database alignment", () => {
  it("accepts only the finance project for both writer and reader", () => {
    expect(publicationDatabasesAlign({
      NEXT_PUBLIC_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
    })).toBe(true);
    expect(publicationDatabasesAlign({
      NEXT_PUBLIC_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
    })).toBe(false);
    expect(publicationDatabasesAlign({
      NEXT_PUBLIC_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
    })).toBe(false);
    expect(publicationDatabasesAlign({})).toBe(false);
  });
});

describe("publication sql and retry wiring", () => {
  const sql = readFileSync("supabase/review/member_publication_insert_once.sql", "utf8");
  const publication = readFileSync("app/staff/(app)/treatments/[id]/member-publication-actions.ts", "utf8");
  const draft = readFileSync("hooks/useTreatmentDraft.ts", "utf8");

  it("inserts once and never updates a conflicting or revoked publication", () => {
    expect(sql).toContain("on conflict (treatment_id) do nothing");
    expect(sql).toContain("member_treatment_publications_treatment_id_key");
    expect(sql).not.toMatch(/on conflict[\s\S]*do update/i);
    expect(sql).toContain("revoke all on function");
    const automatic = publication.slice(publication.indexOf("export async function autoPublishCompletedMemberTreatment"));
    expect(automatic).toContain("assertPublicationDatabasesAlign");
    expect(automatic).toContain(".insert(");
    expect(automatic).not.toContain(".upsert(");
    expect(automatic).toContain('error.code==="23505"');
  });

  it("returns the completed treatment before any second remote write", () => {
    const retry = draft.indexOf("retry member publication without inserting another treatment");
    const remoteComplete = draft.indexOf("const completed = await submitTreatmentRemoteComplete");
    expect(retry).toBeGreaterThan(-1);
    expect(remoteComplete).toBeGreaterThan(retry);
  });
});
