import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TREATMENT_REMOTE_READ_PILOT_ENV, isTreatmentRemoteReadPilotEnabled } from "./treatment-remote-read-flag";
import { TREATMENT_REMOTE_WRITE_PILOT_ENV, isTreatmentRemoteWritePilotEnabled } from "./treatment-remote-write-flag";

const publication = readFileSync(
  "app/staff/(app)/treatments/[id]/member-publication-actions.ts",
  "utf8",
);
const workspace = readFileSync("features/treatments/TreatmentWorkspace.tsx", "utf8");
const page = readFileSync("app/staff/(app)/treatments/page.tsx", "utf8");

describe("automatic member treatment publication", () => {
  it("publishes only after the completed remote treatment is verified", () => {
    const verify = workspace.indexOf("正式療程同步驗證失敗");
    const upload = workspace.indexOf("await storeMemberTreatmentPhotos");
    const complete = workspace.indexOf("await completeTreatment");
    const publish = workspace.indexOf("await autoPublishCompletedMemberTreatment");
    const finished = workspace.indexOf("setFinished(true)");
    expect(verify).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    expect(upload).toBeLessThan(complete);
    expect(publish).toBeGreaterThan(verify);
    expect(finished).toBeGreaterThan(publish);
    expect(workspace).toContain("setCompleteError");
    expect(workspace).not.toMatch(/member_treatment_publications[\s\S]{0,80}\.delete\(/);
  });

  it("lets the completing staff publish without a manager review and refuses revoked rows", () => {
    expect(publication).toContain("export async function autoPublishCompletedMemberTreatment");
    expect(publication).toContain('["STAFF","RECEPTIONIST"]');
    expect(publication).toContain("commitAutomaticPublication");
    const automatic = publication.slice(publication.indexOf("export async function autoPublishCompletedMemberTreatment"));
    expect(automatic).not.toContain("onConflict");
    expect(automatic).toContain("insertPublicationOnce");
    expect(automatic.indexOf("memberSyncCustomerAllowed")).toBeGreaterThan(-1);
    expect(automatic.indexOf("memberSyncCustomerAllowed")).toBeLessThan(automatic.indexOf("createBeautyOsFinanceClient"));
    expect(automatic.indexOf("privatePhotoRefsFromMeta")).toBeLessThan(automatic.indexOf("commitMemberTreatmentCopy"));
    expect(automatic.indexOf("confirmPrivateTreatmentPhotos")).toBeLessThan(automatic.indexOf("commitMemberTreatmentCopy"));
    expect(automatic).not.toContain("withMemberPhotos");
    expect(automatic).not.toContain('from("member_treatment_publications").insert');
    expect(publication).toContain('rpc("insert_member_treatment_publication_once"');
    expect(publication).not.toMatch(/from\("treatments"\)[\s\S]{0,120}\.delete\(/);
    const manual = publication.indexOf("export async function publishMemberTreatment");
    expect(publication.slice(manual, publication.indexOf("export async function autoPublishCompletedMemberTreatment"))).not.toContain("allowStaff");
  });

  it("stays unavailable until remote read, remote write, and remote identities are all present", () => {
    expect(isTreatmentRemoteReadPilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({})).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({ [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1" })).toBe(false);
    expect(isTreatmentRemoteWritePilotEnabled({
      [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
      [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
    })).toBe(true);
    const editor = readFileSync("features/treatments/TreatmentPageClient.tsx", "utf8");
    expect(editor).toContain('customerIdentity.source !== "remote"');
    expect(editor).toContain('appointmentIdentity.source !== "remote"');
    expect(editor).toContain("療程同步身分尚未驗證");
    const adapter = readFileSync("lib/persistence/treatment-remote-adapter.ts", "utf8");
    expect(adapter).toContain("hadPreview: Boolean(photo.hadPreview)");
    expect(adapter).not.toContain("previewUrl");
  });

  it("does not open the legacy completed-treatment migration panel", () => {
    expect(page).toContain("completedMigrationPilot={false}");
    expect(page).not.toContain('process.env.BEAUTY_OS_COMPLETED_TREATMENT_MIGRATION_PILOT === "1"');
  });
});
