import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publication = readFileSync(
  "app/staff/(app)/treatments/[id]/member-publication-actions.ts",
  "utf8",
);
const workspace = readFileSync("features/treatments/TreatmentWorkspace.tsx", "utf8");
const page = readFileSync("app/staff/(app)/treatments/page.tsx", "utf8");

describe("automatic member treatment publication", () => {
  it("publishes only after the completed remote treatment is verified", () => {
    const verify = workspace.indexOf("正式療程同步驗證失敗");
    const publish = workspace.indexOf("await autoPublishCompletedMemberTreatment");
    const finished = workspace.indexOf("setFinished(true)");
    expect(verify).toBeGreaterThan(-1);
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
    expect(automatic).toContain('error.code==="23505"');
    expect(publication).not.toMatch(/from\("treatments"\)[\s\S]{0,120}\.delete\(/);
    const manual = publication.indexOf("export async function publishMemberTreatment");
    expect(publication.slice(manual, publication.indexOf("export async function autoPublishCompletedMemberTreatment"))).not.toContain("allowStaff");
  });

  it("does not open the legacy completed-treatment migration panel", () => {
    expect(page).toContain("completedMigrationPilot={false}");
    expect(page).not.toContain('process.env.BEAUTY_OS_COMPLETED_TREATMENT_MIGRATION_PILOT === "1"');
  });
});
