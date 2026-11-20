import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  memberSyncCompletionState,
  publicationFallbackInsertStatus,
  publicationRpcStatus,
} from "./member-sync-completion";

const PUBLICATION_FAILED = "療程已儲存，但會員身體紀錄公開失敗。請再次按完成療程補公開，勿另建療程。";
const workspace = readFileSync("features/treatments/TreatmentWorkspace.tsx", "utf8");
const publication = readFileSync("app/staff/(app)/treatments/[id]/member-publication-actions.ts", "utf8");
const completeStep = readFileSync("features/treatments/steps/CompleteStep.tsx", "utf8");

describe("complete button after member sync", () => {
  it("keeps the save button and the original message when publication fails", () => {
    const failed = memberSyncCompletionState({ ok: false, message: PUBLICATION_FAILED });
    expect(failed).toEqual({
      finished: false,
      markAppointmentCompleted: false,
      error: PUBLICATION_FAILED,
    });
    expect(failed.error).not.toContain("Minified React error #441");
    expect(completeStep).toContain('nextLabel="儲存並完成服務"');
    expect(completeStep).toContain("{validationError}");
  });

  it("finishes only after a successful sync, including a retry of the same treatment", () => {
    const first = memberSyncCompletionState({ ok: false, message: PUBLICATION_FAILED });
    const retry = memberSyncCompletionState({ ok: false, message: PUBLICATION_FAILED });
    const saved = memberSyncCompletionState({ ok: true });
    expect(first.finished).toBe(false);
    expect(retry.finished).toBe(false);
    expect(retry.markAppointmentCompleted).toBe(false);
    expect(saved).toEqual({ finished: true, markAppointmentCompleted: true, error: "" });
  });

  it("does not throw the publication failure out of the server action", () => {
    const sync = publication.slice(publication.indexOf("export async function syncBrowserCompletedMemberTreatment"));
    const complete = workspace.slice(workspace.indexOf("async function handleComplete"));
    expect(sync.indexOf("return {ok:false,message}")).toBeGreaterThan(-1);
    expect(sync.indexOf("catch")).toBeGreaterThan(-1);
    expect(sync.indexOf("await persistBrowserCompletedTreatment")).toBeLessThan(sync.indexOf("await autoPublishCompletedMemberTreatment"));
    expect(complete.indexOf("const persisted = await completeTreatment")).toBeLessThan(complete.indexOf("await syncBrowserCompletedMemberTreatment"));
    expect(complete.indexOf("memberSyncCompletionState")).toBeLessThan(complete.indexOf("setFinished(true)"));
    expect(complete).toContain("if (!screen.finished)");
    expect(complete).toContain("return;");
    expect(workspace).not.toContain("BEAUTY_OS_TREATMENT_REMOTE_WRITE_PILOT");
  });

  it("treats an unauthorized publication function as one insert, and a unique conflict as the same row", () => {
    expect(publicationRpcStatus("unauthorized")).toBe("unauthorized");
    expect(publicationRpcStatus("inserted")).toBe("ok");
    expect(publicationRpcStatus("failed")).toBe("error");
    expect(publicationFallbackInsertStatus(undefined)).toBe("ok");
    expect(publicationFallbackInsertStatus("23505")).toBe("conflict");
    expect(publicationFallbackInsertStatus("23503")).toBe("error");
    const writer = publication.slice(
      publication.indexOf("async function insertPublicationOnce"),
      publication.indexOf("export async function autoPublishCompletedMemberTreatment"),
    );
    expect(writer).toContain('rpc("insert_member_treatment_publication_once"');
    expect(writer.indexOf("publicationRpcStatus")).toBeLessThan(writer.indexOf('from("member_treatment_publications").insert'));
    expect(writer).toContain("publicationFallbackInsertStatus");
    expect(writer).not.toContain(".upsert(");
    expect(writer).not.toContain(".update(");
    expect(writer).not.toContain(".delete(");
  });
});
