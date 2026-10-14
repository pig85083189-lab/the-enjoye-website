// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeAppointmentReminderCron,
  evaluateAppointmentReminderCronRpcResults,
  isAppointmentReminderCronPrivilegeError,
} from "@/lib/line/automations/appointment-reminder-cron";
import { RUN_LINE_APPOINTMENT_REMINDER_CRON_DRY_RUN_RPC } from "@/lib/line/automations/appointment-reminder-rpc";
import { LINE_APPOINTMENT_REMINDER_SEND_OPEN } from "@/lib/line/automations/appointment-reminder-flag";
import { applyLineBroadcastChannelClaimStep, sharedChannelFixtureAccounts } from "@/lib/line/line-channel-lock";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2D-3 PostgREST privilege and cron reporting", () => {
  it("classifies privilege errors as 500 and never reports success", () => {
    expect(
      isAppointmentReminderCronPrivilegeError({
        code: "42501",
        message: "unauthorized",
      }),
    ).toBe(true);
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: { code: "42501", message: "unauthorized" },
        tickError: null,
        tickData: { checked: 2 },
      }),
    ).toEqual({ ok: false, message: "Dry-run RPC 權限失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: { message: "permission denied for function" },
        tickData: { checked: 2 },
      }),
    ).toEqual({ ok: false, message: "Dry-run RPC 權限失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: { message: "rpc" },
        tickData: { checked: 2, sent: true },
      }),
    ).toEqual({ ok: false, message: "Dry-run RPC 失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: null,
        tickData: { checked: 2, sent: true },
      }),
    ).toEqual({ ok: false, message: "Dry-run RPC 失敗，沒有發送 LINE" });
    expect(
      evaluateAppointmentReminderCronRpcResults({
        finalizeError: null,
        tickError: null,
        tickData: { checked: 2, sent: false },
      }),
    ).toEqual({ ok: true, checked: 2 });
    expect(
      authorizeAppointmentReminderCron({
        authorization: "Bearer wrong-secret-16",
        env: { CRON_SECRET: "cron-secret-16ch" },
      }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("uses a GRANT-locked cron RPC and does not trust JWT claims", () => {
    const sql = source(
      "supabase/migrations/20261014120000_line_appointment_reminder_postgrest_service_role.sql",
    );
    const route = source("app/api/cron/line-appointment-reminders/route.ts");
    const cron = source("lib/line/automations/appointment-reminder-cron.ts");
    expect(RUN_LINE_APPOINTMENT_REMINDER_CRON_DRY_RUN_RPC).toBe(
      "run_line_appointment_reminder_cron_dry_run",
    );
    expect(sql).toMatch(/line_appointment_reminder_service_role_call_allowed/);
    expect(sql).toMatch(/p_function not in \(/);
    expect(sql).not.toMatch(/session_user = 'authenticator'/);
    expect(sql).toMatch(/aclexplode/);
    expect(sql).toMatch(/has_function_privilege\('anon'/);
    expect(sql).toMatch(/has_function_privilege\('authenticated'/);
    expect(sql).toMatch(/has_function_privilege\('authenticator'/);
    expect(sql).toMatch(/has_function_privilege\('service_role'/);
    expect(sql).toMatch(/revoke all on function public\.line_appointment_reminder_service_role_call_allowed\(text\)[\s\S]*service_role/);
    expect(sql).toMatch(/revoke all on function %s from authenticator/);
    expect(sql).toMatch(/if not public\.user_is_org_owner\(p_organization_id\)/);
    expect(sql).toMatch(/Owner entry only\. Never finalize, claim, or run globally/);
    expect(sql).toMatch(/revoke all on function public\.run_line_appointment_reminder_dry_run\(text\)[\s\S]*service_role/);
    expect(sql).toMatch(/revoke all on function public\.run_line_appointment_reminder_dry_run\(text\) from service_role/);
    expect(sql).toMatch(/run_line_appointment_reminder_cron_dry_run\(\)/);
    expect(sql).toMatch(/revoke all on function public\.run_line_appointment_reminder_cron_dry_run\(\)/);
    expect(sql).toMatch(/revoke all on function public\.line_appointment_reminder_dry_run_internal\(text\)/);
    expect(sql).not.toMatch(/current_setting\(\s*'request\.jwt/);
    expect(sql).not.toMatch(/current_user = 'service_role'|current_user in \('service_role'/);
    expect(sql).not.toMatch(/claim_line_broadcast|executeLineBroadcastHttp|api\.line\.me/);
    expect(sql).toMatch(/870121/);
    expect(sql).toMatch(/Rollback/);
    expect(route).toMatch(/RUN_LINE_APPOINTMENT_REMINDER_CRON_DRY_RUN_RPC/);
    expect(route).not.toMatch(/RUN_LINE_APPOINTMENT_REMINDER_DRY_RUN_RPC/);
    expect(route).toMatch(/status: 500/);
    expect(route).toMatch(/mode: "dry_run"/);
    expect(route).toMatch(/sent: false/);
    expect(route).not.toMatch(/executeCustomerLinePushHttp|\/v2\/bot\/message\/push|line_user_id|CRON_SECRET/);
    expect(cron).not.toMatch(/request\.jwt|line_user_id|channel_access_token/);
    expect(source("vercel.json")).toMatch(/0 3 \* \* \*/);
    expect(source("vercel.json")).not.toMatch(/\*\/15 \* \* \* \*/);
  });

  it("keeps Calendar create/cancel/reschedule on the persist hook", () => {
    const calendar = source("features/calendar/CalendarPage.tsx");
    const createHook = source("features/calendar/use-calendar-remote-write.ts");
    const cancelHook = source("features/calendar/use-calendar-remote-cancel.ts");
    const rescheduleHook = source("features/calendar/use-calendar-remote-reschedule.ts");
    const writePilot = source("lib/appointments/appointment-remote-write-pilot.ts");
    const mutatePilot = source("lib/appointments/appointment-remote-mutate-pilot.ts");
    const persist = source("lib/line/automations/appointment-reminder-write-hook.ts");
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCreate/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentCancel/);
    expect(calendar).toMatch(/submitCalendarRemoteAppointmentReschedule/);
    expect(calendar).not.toMatch(/appointment-remote-mutate-pilot|appointment-remote-write-pilot/);
    expect(calendar).toMatch(/if \(initial\) updateAppointment/);
    expect(calendar).toMatch(/readOnly=\{calendarRemoteReadPilot\}/);
    expect(createHook).toMatch(/runAuthenticatedAppointmentWriteCreate/);
    expect(cancelHook).toMatch(/runAuthenticatedAppointmentWriteMutate/);
    expect(cancelHook).toMatch(/kind: "cancel"/);
    expect(rescheduleHook).toMatch(/runAuthenticatedAppointmentWriteMutate/);
    expect(rescheduleHook).toMatch(/kind: "reschedule"/);
    expect(writePilot).toMatch(/notifyAppointmentWrittenForReminders/);
    expect(mutatePilot).toMatch(/notifyAppointmentWrittenForReminders/);
    expect(persist).toMatch(/syncAppointment|sync_line_appointment_reminder_jobs/);
    expect(persist).not.toMatch(/executeCustomerLinePushHttp|api\.line\.me/);
    expect(source("scripts/line-appointment-reminder-local-pg.sh")).toMatch(
      /20261014120000_line_appointment_reminder_postgrest_service_role\.sql/,
    );
    expect(source("scripts/line-appointment-reminder-hobby-dry-run.sh")).toMatch(
      /0 3 \* \* \*/,
    );
    expect(source("scripts/line-appointment-reminder-hobby-dry-run.sh")).toMatch(
      /PREVIEW_CRON_URL/,
    );
    expect(source("scripts/line-appointment-reminder-hobby-dry-run.sh")).not.toMatch(
      /https:\/\/api\.line\.me|SUPABASE_SERVICE_ROLE_KEY|echo "\$SECRET"|echo "\$CRON_SECRET"/,
    );
  });

  it("does not reopen Broadcast send or reminder send", () => {
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_APPOINTMENT_REMINDER_SEND_OPEN).toBe(false);
    const claimed = applyLineBroadcastChannelClaimStep(
      {
        channelId: "2009219238",
        accounts: sharedChannelFixtureAccounts(),
        rows: [],
        permits: { [ORG_ENJOYE_ID]: false },
      },
      {
        organizationId: ORG_ENJOYE_ID,
        requestId: "lbrq-broadcastok0001",
        textBody: "群發",
        sendMode: "formal",
        quotaKnown: true,
        quotaRemaining: null,
        quotaCheckedAt: new Date().toISOString(),
      },
    );
    expect(claimed.claimed).toBe(true);
  });
});
