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
  memberPublicationSyncMode,
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

  it("one treatment id accepts a single writer when two completions race", async () => {
    const box: { row: { customer_id: string; approved_fields: typeof fields; revoked_at: null } | null } = { row: null };
    let queue = Promise.resolve();
    const insert = () => {
      const previous = queue;
      let release = () => {};
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous.then(() => {
        try {
          if (box.row) return "conflict" as const;
          box.row = row;
          return "ok" as const;
        } finally {
          release();
        }
      });
    };
    const [first, second] = await Promise.all([
      commitAutomaticPublication({ customerId: "customer-1", fields, read: async () => box.row, insert }),
      commitAutomaticPublication({ customerId: "customer-1", fields, read: async () => box.row, insert }),
    ]);
    expect([first, second].sort()).toEqual(["already", "inserted"]);
    expect(box.row?.customer_id).toBe("customer-1");
  });

  it("a revoke returned by the atomic write stays revoked", async () => {
    await expect(commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => null,
      insert: async () => "revoked",
    })).rejects.toThrow("無法自動重新公開");
  });

  it("a different owner returned by the atomic write does not replace the row", async () => {
    const stored = { ...row, customer_id: "customer-2" };
    await expect(commitAutomaticPublication({
      customerId: "customer-1",
      fields,
      read: async () => null,
      insert: async () => "mismatch",
    })).rejects.toThrow("勿重複建立療程");
    expect(stored.customer_id).toBe("customer-2");
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

  it("copies from the booking writer onto the finance reader without retargeting the writer", () => {
    expect(memberPublicationSyncMode({
      NEXT_PUBLIC_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
    })).toBe("booking-to-finance");
    expect(memberPublicationSyncMode({
      NEXT_PUBLIC_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: FINANCE_SUPABASE_ORIGIN,
    })).toBe("same-finance");
    expect(memberPublicationSyncMode({
      NEXT_PUBLIC_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
      BEAUTY_OS_SUPABASE_URL: BOOKING_SUPABASE_ORIGIN,
    })).toBeNull();
    expect(memberPublicationSyncMode({})).toBeNull();
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
    const writer = publication.slice(
      publication.indexOf("async function insertPublicationOnce"),
      publication.indexOf("export async function autoPublishCompletedMemberTreatment"),
    );
    expect(automatic).toContain("assertMemberPublicationTarget");
    expect(automatic).toContain("member_treatment_mirrors");
    expect(automatic).toContain("member_booking_finance_identity_links");
    expect(automatic).toContain("insertPublicationOnce");
    expect(automatic).toContain("publicationApprover");
    expect(automatic).not.toMatch(/full_name|phone/);
    expect(automatic).not.toContain('from("member_treatment_publications").insert');
    expect(automatic).not.toContain(".upsert(");
    expect(automatic).toContain('error.code==="23505"');
    expect(writer).toContain('rpc("insert_member_treatment_publication_once"');
    expect(sql).toContain("if not found then");
    expect(sql).toContain("approved_by must be uuid");
  });

  it("returns the completed treatment before any second remote write", () => {
    const retry = draft.indexOf("retry member publication without inserting another treatment");
    const remoteComplete = draft.indexOf("const completed = await submitTreatmentRemoteComplete");
    expect(retry).toBeGreaterThan(-1);
    expect(remoteComplete).toBeGreaterThan(retry);
  });
});
