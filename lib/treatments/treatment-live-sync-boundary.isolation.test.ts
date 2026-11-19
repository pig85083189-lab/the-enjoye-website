import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCalendarCreateSurface } from "@/lib/appointments/appointment-write-surface";

describe("new treatment sync boundary", () => {
  const hook = readFileSync("hooks/useTreatmentDraft.ts", "utf8");
  const workspace = readFileSync("features/treatments/TreatmentWorkspace.tsx", "utf8");

  it("leaves old browser records out of the live completion path", () => {
    expect(hook).not.toContain("syncBrowserCompletedTreatment");
    expect(hook).not.toContain("pendingBrowserSync");
    expect(existsSync("lib/treatments/sync-browser-completed-treatment.ts")).toBe(false);
    expect(existsSync("scripts/beauty-os-local-backup.js")).toBe(false);
  });

  it("does not report a local save after the remote completion path starts", () => {
    const complete = hook.slice(hook.indexOf("const completeTreatment"));
    const remoteBranch = complete.slice(complete.indexOf("正式資料庫尚未建立療程草稿"));
    expect(remoteBranch).not.toContain("saveCompletedTreatment");
    expect(remoteBranch).toContain("正式資料庫回讀驗證失敗");

    const handler = workspace.slice(workspace.indexOf("async function handleComplete"));
    const tryBlock = handler.slice(handler.indexOf("try {"), handler.indexOf("} catch"));
    const catchBlock = handler.slice(handler.indexOf("} catch"));
    expect(tryBlock).toContain("await completeTreatment");
    expect(tryBlock).toContain("setFinished(true)");
    expect(catchBlock).toContain("setCompleteError");
    expect(catchBlock).not.toContain("setFinished");
    expect(catchBlock).not.toContain("saveCompletedTreatment");
  });

  it("keeps appointment remote create from falling back to the browser", () => {
    expect(resolveCalendarCreateSurface({
      calendarRemoteReadPilot: true,
      appointmentRemoteWritePilot: true,
      canCreateAppointment: true,
    })).toEqual({ createEnabled: true, remoteCreate: true, localCreate: false });
    expect(resolveCalendarCreateSurface({
      calendarRemoteReadPilot: true,
      appointmentRemoteWritePilot: false,
      canCreateAppointment: true,
    })).toEqual({ createEnabled: false, remoteCreate: false, localCreate: false });
    expect(resolveCalendarCreateSurface({
      calendarRemoteReadPilot: false,
      appointmentRemoteWritePilot: false,
      canCreateAppointment: true,
    })).toEqual({ createEnabled: true, remoteCreate: false, localCreate: true });
  });
});
