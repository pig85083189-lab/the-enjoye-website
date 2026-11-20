// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CONSULTATION_FIELDS } from "../consultation-settings";
import { privatePhotoRefsFromMeta } from "./member-photo-storage";
import { memberPublicationFields } from "./member-publication-fields.mjs";
import { DEFAULT_CONSULTATION_FIELDS as backfillDefaults } from "../../scripts/publication-backfill-defaults.mjs";
import { photoRefs } from "../../scripts/backfill-member-publication.mjs";

describe("member publication fields", () => {
  it("keeps the clinical snapshot and leaves status on the mirror", () => {
    const fields = memberPublicationFields({
      professional_note: "  今天以淋巴引流為主  ",
      assessment: { concerns: ["緊繃"], clientFocus: "肩頸", sensitivityLevel: 2, consultationAnswers: { "focus-areas": ["肩頸"] } },
      body_markers: [{ area: "肩頸", conditions: ["緊"], note: "左側" }],
      follow_up: { note: "兩週後", tags: ["回訪"], suggestNextBooking: true, suggestedDate: "2026-12-04" },
      products: [{ label: "精華" }],
      status: "COMPLETED",
      completed_at: "2026-11-20T14:28:45.000Z",
    }, [{ id: "focus-areas", label: "加強部位" }]);
    expect(fields).toMatchObject({
      professional_note: "今天以淋巴引流為主",
      concerns: ["緊繃"],
      client_focus: "肩頸",
      sensitivity_level: 2,
      consultation_answers: [{ label: "加強部位", value: "肩頸" }],
      body_marker_details: [{ area: "肩頸", conditions: ["緊"], note: "左側" }],
      follow_up_note: "兩週後",
      suggest_next_booking: true,
      products: ["精華"],
    });
    expect(fields).not.toHaveProperty("status");
    expect(fields).not.toHaveProperty("completed_at");
    expect(fields).not.toHaveProperty("service_name");
    expect(fields).not.toHaveProperty("photos");
  });

  it("uses the same consultation defaults and private photo refs as the server", () => {
    expect(backfillDefaults).toEqual(DEFAULT_CONSULTATION_FIELDS);
    const treatmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const meta = [
      { id: "photo-a-b", type: "BEFORE", hadPreview: true, privateObject: true },
      { id: "photo-c-d", type: "AFTER", hadPreview: true, privateObject: false },
    ];
    const official = privatePhotoRefsFromMeta(treatmentId, [meta[0]]);
    expect(official.ok).toBe(true);
    if (official.ok) {
      expect(photoRefs(treatmentId, [meta[0]])).toEqual({ ok: true, photos: official.photos });
    }
    expect(photoRefs(treatmentId, meta).ok).toBe(false);
    expect(privatePhotoRefsFromMeta(treatmentId, meta).ok).toBe(false);
  });
});
