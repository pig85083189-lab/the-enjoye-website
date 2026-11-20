import { describe, expect, it } from "vitest";
import { memberBodyRecordVisible } from "./member-treatment-sync-visibility";
import {
  commitMemberTreatmentCopy,
  financeMemberFromEvidence,
  type MirrorRecord,
} from "./member-treatment-sync";

const financeOrg = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const member = "11111111-1111-4111-8111-111111111111";
const otherMember = "33333333-3333-4333-8333-333333333333";
const bookingCustomer = "22222222-2222-4222-8222-222222222222";
const treatmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fields = {
  status: "COMPLETED",
  completed_at: "2026-11-18T02:30:00.000Z",
  service_name: "美胸 SPA",
  staff_name: "林美容師",
  professional_note: "今天以淋巴引流為主",
  client_feeling: "結束後輕鬆很多",
  consultation_answers: [
    { label: "適合產品", value: "玫瑰精華" },
    { label: "加強部位", value: "左手臂" },
    { label: "備註", value: "皮膚偏乾" },
  ],
  body_marker_details: [{ area: "左手臂", conditions: ["緊繃"], note: "左側結節感" }],
  photos: [
    { src: "https://the-enjoye-website.vercel.app/right.jpg", label: "右側", side: "right" },
    { src: "https://the-enjoye-website.vercel.app/left.jpg", label: "左側", side: "left" },
  ],
};

function mirror(customerId = member): MirrorRecord {
  return {
    treatment_id: treatmentId,
    organization_id: financeOrg,
    customer_id: customerId,
    booking_customer_id: bookingCustomer,
    status: "COMPLETED",
    completed_at: "2026-11-18T02:30:00.000Z",
    service_name: "美胸 SPA",
    staff_name: "林美容師",
    assessment: { consultationAnswers: { "suitable-products": "玫瑰精華" }, clientFocus: "手臂循環" },
    body_markers: [{ area: "左手臂", conditions: ["緊繃"], note: "左側結節感" }],
    body_map_note: "手臂需要放鬆",
    professional_note: "今天以淋巴引流為主",
    client_feeling: "結束後輕鬆很多",
    discomfort_note: "按壓時稍微痠",
    follow_up: { note: "今晚多喝水", suggestNextBooking: true, suggestedDate: "2026-12-02" },
    products: [{ label: "玫瑰精華" }],
    suggested_tracking_areas: ["左手臂"],
  };
}

function memory() {
  const mirrors = new Map<string, MirrorRecord>();
  const publications = new Map<string, { customer_id: string; approved_fields: unknown; revoked_at: string | null }>();
  let mirrorInserts = 0;
  let publicationInserts = 0;
  return {
    mirrors,
    publications,
    counts: () => ({ mirrorInserts, publicationInserts }),
    async copy(row = mirror()) {
      return commitMemberTreatmentCopy({
        mirror: row,
        fields,
        readMirror: async () => mirrors.get(row.treatment_id) ?? null,
        insertMirror: async () => {
          mirrorInserts += 1;
          if (mirrors.has(row.treatment_id)) return "conflict";
          mirrors.set(row.treatment_id, row);
          return "ok";
        },
        readPublication: async () => {
          const stored = publications.get(row.treatment_id);
          return stored ? { ...stored } : null;
        },
        insertPublication: async () => {
          publicationInserts += 1;
          if (publications.has(row.treatment_id)) return "conflict";
          publications.set(row.treatment_id, {
            customer_id: row.customer_id,
            approved_fields: fields,
            revoked_at: null,
          });
          return "ok";
        },
      });
    },
  };
}

describe("finance member identity", () => {
  const verified = {
    financeCustomerId: member,
    confirmationStatus: "CONFIRMED",
    customerStatus: "ACTIVE",
    verifiedLineSubjects: 1,
  };

  it("accepts one confirmed active LINE member and ignores name or phone", () => {
    expect(financeMemberFromEvidence([verified])).toEqual({ customerId: member });
    expect(financeMemberFromEvidence([])).toBeNull();
    expect(financeMemberFromEvidence([verified, { ...verified, financeCustomerId: otherMember }])).toBeNull();
    expect(financeMemberFromEvidence([{ ...verified, confirmationStatus: "PENDING" }])).toBeNull();
    expect(financeMemberFromEvidence([{ ...verified, customerStatus: "ARCHIVED" }])).toBeNull();
    expect(financeMemberFromEvidence([{ ...verified, verifiedLineSubjects: 0 }])).toBeNull();
    expect(financeMemberFromEvidence([{ ...verified, verifiedLineSubjects: 2 }])).toBeNull();
    expect(financeMemberFromEvidence([{ ...verified, financeCustomerId: "" }])).toBeNull();
  });
});

describe("booking treatment copied once onto the finance member", () => {
  it("stores the full clinical snapshot for that member and retries without a second row", async () => {
    const store = memory();
    await expect(store.copy()).resolves.toBe("inserted");
    await expect(store.copy()).resolves.toBe("already");
    expect(store.counts()).toEqual({ mirrorInserts: 1, publicationInserts: 1 });
    expect(store.mirrors.size).toBe(1);
    const visible = memberBodyRecordVisible({
      organizationId: financeOrg,
      customerId: member,
      mirrors: [...store.mirrors.values()],
      publications: [...store.publications.entries()].map(([treatment_id, row]) => ({ treatment_id, ...row })),
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: treatmentId,
      serviceName: "美胸 SPA",
      staffName: "林美容師",
      professionalNote: "今天以淋巴引流為主",
      clientFeeling: "結束後輕鬆很多",
      bodyMapNote: "手臂需要放鬆",
      discomfortNote: "按壓時稍微痠",
    });
    expect(visible[0].assessment).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "適合產品", value: "玫瑰精華" })]),
    );
    expect(visible[0].markers).toEqual([expect.objectContaining({ area: "左手臂", note: "左側結節感" })]);
    expect(visible[0].photos.map((photo) => photo.side)).toEqual(["left", "right"]);
    expect(memberBodyRecordVisible({
      organizationId: financeOrg,
      customerId: otherMember,
      mirrors: [...store.mirrors.values()],
      publications: [...store.publications.entries()].map(([treatment_id, row]) => ({ treatment_id, ...row })),
    })).toEqual([]);
  });

  it("does not insert a publication when the mirror write fails", async () => {
    const store = memory();
    await expect(commitMemberTreatmentCopy({
      mirror: mirror(),
      fields,
      readMirror: async () => null,
      insertMirror: async () => "error",
      readPublication: async () => null,
      insertPublication: async () => {
        throw new Error("publication must stay unwritten");
      },
    })).rejects.toThrow("請再次按完成療程補同步，勿另建療程");
    expect(store.publications.size).toBe(0);
  });

  it("does not move an existing mirror onto another member", async () => {
    const store = memory();
    await store.copy();
    await expect(store.copy(mirror(otherMember))).rejects.toThrow("屬於其他顧客");
    expect(store.mirrors.get(treatmentId)?.customer_id).toBe(member);
    expect(store.counts().mirrorInserts).toBe(1);
  });

  it("keeps a revoked publication revoked on retry", async () => {
    const row = mirror();
    const publications = new Map([[treatmentId, { customer_id: member, approved_fields: fields, revoked_at: "2026-11-20T00:00:00.000Z" }]]);
    await expect(commitMemberTreatmentCopy({
      mirror: row,
      fields,
      readMirror: async () => row,
      insertMirror: async () => "ok",
      readPublication: async () => publications.get(treatmentId) ?? null,
      insertPublication: async () => "ok",
    })).rejects.toThrow("無法自動重新公開");
    expect(publications.get(treatmentId)?.revoked_at).toBeTruthy();
  });
});
