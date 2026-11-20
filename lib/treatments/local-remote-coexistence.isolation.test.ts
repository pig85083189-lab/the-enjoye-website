import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  combineLocalAndRemoteTreatments,
  remoteTreatmentWriteStoppedByStoredLocal,
  type TreatmentCoexistenceRecord,
} from "./local-remote-coexistence";

const ORG = "org-the-enjoye";

function treatment(overrides: Partial<TreatmentCoexistenceRecord> = {}): TreatmentCoexistenceRecord {
  return {
    id: "treatment-apt-nov19",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    appointmentId: "apt-nov19-abcdef",
    customerId: "cust-line-1",
    staffId: "staff-001",
    serviceId: "svc-upup",
    status: "completed",
    assessment: { concerns: ["乾燥"] },
    bodyMarkers: [{ area: "肩頸" }],
    bodyMapNote: "右肩",
    professionalNote: "保濕",
    clientFeeling: "舒服",
    followUp: { note: "兩週後", suggestedDate: "2026-12-03" },
    suggestedTrackingAreas: ["肩頸"],
    ...overrides,
  };
}

describe("local and remote treatments coexist", () => {
  it("keeps the 2026/11/19 browser treatment visible and does not upload it", () => {
    const local = treatment();
    const remote = treatment({
      id: "trt-other-aaaaaa",
      appointmentId: "apt-other",
      customerId: "cust-other",
      professionalNote: "其他客人",
    });
    const snapshot = JSON.stringify(local);
    const result = combineLocalAndRemoteTreatments({
      remoteReadEnabled: true,
      remoteReady: true,
      localTreatments: [local],
      remoteTreatments: [remote],
    });
    expect(result.records.map((item) => item.id)).toEqual(["trt-other-aaaaaa", "treatment-apt-nov19"]);
    expect(result.conflicts).toEqual([]);
    expect(JSON.stringify(local)).toBe(snapshot);
    const source = readFileSync("lib/treatments/local-remote-coexistence.ts", "utf8");
    expect(source).not.toMatch(/supabase|saveCompletedTreatment|localStorage/);
    expect(source).not.toMatch(/customerName|guestContactPhone|\.phone/);
  });

  it("shows a new Supabase treatment beside an unmatched browser treatment", () => {
    const result = combineLocalAndRemoteTreatments({
      remoteReadEnabled: true,
      remoteReady: true,
      localTreatments: [treatment()],
      remoteTreatments: [treatment({ id: "trt-new-aaaaaa", appointmentId: "apt-new", customerId: "cust-new" })],
    });
    expect(result.records.map((item) => item.id)).toContain("trt-new-aaaaaa");
    expect(result.records.map((item) => item.id)).toContain("treatment-apt-nov19");
  });

  it("does not collapse different customers onto one treatment", () => {
    const local = treatment();
    const remote = treatment({ id: "trt-same-name", customerId: "cust-other", appointmentId: "apt-other" });
    const result = combineLocalAndRemoteTreatments({
      remoteReadEnabled: true,
      remoteReady: true,
      localTreatments: [local],
      remoteTreatments: [remote],
    });
    expect(result.records).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  it("reports a conflict and keeps both rows when identity or clinical content disagrees", () => {
    const local = treatment({ id: "trt-shared-aaaaaa" });
    const remote = treatment({ id: "trt-shared-aaaaaa", professionalNote: "正式庫不同內容" });
    const result = combineLocalAndRemoteTreatments({
      remoteReadEnabled: true,
      remoteReady: true,
      localTreatments: [local],
      remoteTreatments: [remote],
    });
    expect(result.records).toHaveLength(2);
    expect(result.conflicts).toEqual([{ local, remote, reason: "content" }]);
    expect(remote.professionalNote).toBe("正式庫不同內容");
    expect(local.professionalNote).toBe("保濕");
  });

  it("keeps the browser treatment when the remote read fails", () => {
    const local = treatment();
    const result = combineLocalAndRemoteTreatments({
      remoteReadEnabled: true,
      remoteReady: false,
      localTreatments: [local],
      remoteTreatments: [],
    });
    expect(result.records).toEqual([local]);
    expect(result.remoteIncluded).toBe(false);
    const page = readFileSync("features/treatments/TreatmentsListPageClient.tsx", "utf8");
    expect(page).toContain("無法載入療程紀錄");
    expect(page).toContain("listStoredCompletedTreatments");
  });

  it("stops a remote completion when the same treatment id has different content", () => {
    const local = treatment({ id: "trt-shared-aaaaaa", professionalNote: "本機內容" });
    const remote = treatment({ id: "trt-shared-aaaaaa", professionalNote: "正式內容" });
    expect(remoteTreatmentWriteStoppedByStoredLocal(remote, [local])).toBe(true);
    expect(remoteTreatmentWriteStoppedByStoredLocal(remote, [remote])).toBe(false);
    const hook = readFileSync("hooks/useTreatmentDraft.ts", "utf8");
    const remoteWrite = hook.slice(hook.indexOf("if (!remoteRecordReady.current)"));
    expect(remoteWrite.indexOf("remoteTreatmentWriteStoppedByStoredLocal")).toBeLessThan(
      remoteWrite.indexOf("submitTreatmentRemoteComplete"),
    );
    expect(readFileSync("features/today/TodayDashboard.tsx", "utf8")).not.toMatch(
      /todayRemoteReadPilot\s*\?\s*\[\]/,
    );
    expect(readFileSync("features/customers/tabs/TreatmentsTab.tsx", "utf8")).toContain(
      "combineLocalAndRemoteTreatments",
    );
    expect(readFileSync("features/customers/tabs/TreatmentsTab.tsx", "utf8")).not.toContain(
      "seenAppointments",
    );
  });

  it("does not upload a browser completion while opening a remote-backed screen", () => {
    const hook = readFileSync("hooks/useTreatmentDraft.ts", "utf8");
    expect(hook).not.toContain("syncBrowserCompletedTreatment");
    expect(hook).toContain("本機已完成療程與正式資料庫尚未確認完全一致");
    const workspace = readFileSync("features/treatments/TreatmentWorkspace.tsx", "utf8");
    const handler = workspace.slice(workspace.indexOf("async function handleComplete"));
    const tryBlock = handler.slice(handler.indexOf("try {"), handler.indexOf("} catch"));
    const catchBlock = handler.slice(handler.indexOf("} catch"));
    expect(tryBlock).toContain("await completeTreatment");
    expect(tryBlock.indexOf("setFinished(true)")).toBeGreaterThan(tryBlock.indexOf("await completeTreatment"));
    expect(catchBlock).toContain("setCompleteError");
    expect(catchBlock).not.toContain("setFinished");
    expect(catchBlock).not.toContain("saveCompletedTreatment");
  });
});
