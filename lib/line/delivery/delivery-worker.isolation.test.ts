// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import {
  createScriptedMockLineMessagingAdapter,
} from "@/lib/line/delivery/delivery-adapter";
import {
  mapLineDeliveryRecord,
  mapLineDeliveryRecords,
  lineDeliveryKindLabel,
  lineDeliveryMockAcceptedLabel,
  lineDeliveryRecordHasForbiddenKeys,
} from "@/lib/line/delivery/delivery-records";
import {
  CLAIM_NEXT_LINE_DELIVERY_TASK_RPC,
  COMPLETE_LINE_DELIVERY_TASK_RPC,
  READ_LINE_DELIVERY_TASKS_RPC,
} from "@/lib/line/delivery/delivery-store";
import {
  createLineDeliveryMockWorkerAdapter,
  parseLineDeliveryClaimedTask,
  planLineDeliveryMockComplete,
  runLineDeliveryMockWorkerTick,
} from "@/lib/line/delivery/delivery-worker";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";
import { LINE_DELIVERY_WORKER_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-tasks-local-pg.sh";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function executableSql(rel: string): string {
  return source(rel)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Phase 3C LINE delivery mock worker", () => {
  it("keeps send gates closed and never opens Owner RPCs to anonymous callers", () => {
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);
    expect(CLAIM_NEXT_LINE_DELIVERY_TASK_RPC).toBe("claim_next_line_delivery_task");
    expect(READ_LINE_DELIVERY_TASKS_RPC).toBe("read_line_delivery_tasks");
    expect(COMPLETE_LINE_DELIVERY_TASK_RPC).toBe("complete_line_delivery_task");

    const sql = executableSql(LINE_DELIVERY_WORKER_MIGRATION_FILE);
    expect(sql).toMatch(/87210001/);
    expect(sql).toMatch(/line_delivery_broadcast_quota_used/);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/mock_accepted/);
    expect(sql).toMatch(/revoke all on function public\.claim_next_line_delivery_task\(text\)\s+from public, anon/);
    expect(sql).toMatch(/revoke all on function public\.read_line_delivery_tasks\(text\)\s+from public, anon/);
    expect(sql).toMatch(/revoke all on function public\.line_delivery_broadcast_quota_used\(text\)\s+from public, anon, authenticated/);
    expect(sql).not.toMatch(/create or replace function public\.claim_line_broadcast_send/);
    expect(sql).not.toMatch(/alter table public\.line_broadcasts/);
    expect(sql).not.toMatch(/https:\/\/api\.line\.me|pg_cron|cron\.schedule/);
    expect(sql).not.toMatch(/line_user_id text|channel_access_token|channel_secret/);
    expect(sql).not.toMatch(/LINE_AUTOMATION_SEND_OPEN = true|LINE_BROADCAST_SEND_OPEN = true/);
  });

  it("keeps the mock worker and records modules off the live LINE origin", () => {
    const files = [
      "lib/line/delivery/delivery-worker.ts",
      "lib/line/delivery/delivery-actions.ts",
      "lib/line/delivery/delivery-records.ts",
      "features/line/automations/LineDeliveryRecordsCard.tsx",
      "features/line/automations/LineDeliveryMockWorkerCard.tsx",
    ];
    const joined = files.map(source).join("\n");
    expect(joined).not.toMatch(/https:\/\/api\.line\.me|\/v2\/bot\/message/);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/executeLineBroadcastHttp|executeLineTestPushHttp/);
    expect(joined).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(joined).not.toMatch(/pg_cron|cron\.schedule/);
    expect(source("lib/line/delivery/delivery-actions.ts")).toMatch(
      /getServerStaffAuthUser|evaluateLineAutomationOwnerAccess/,
    );
    expect(source("lib/line/delivery/delivery-actions.ts")).toMatch(
      /CLAIM_NEXT_LINE_DELIVERY_TASK_RPC|READ_LINE_DELIVERY_TASKS_RPC/,
    );
    expect(source("lib/line/delivery/delivery-actions.ts")).toMatch(/sentLine: false/);
  });

  it("treats mock accepted as not a real LINE delivery", async () => {
    const accepted = planLineDeliveryMockComplete(
      await createLineDeliveryMockWorkerAdapter().send({
        deliveryKey: "10:automation|14:org-the-enjoye|4:mock|6:cust-2",
        textBody: "mock",
      }),
    );
    expect(accepted.status).toBe("accepted");
    expect(accepted.mockAccepted).toBe(true);
    expect(accepted.sentLine).toBe(false);
    expect(accepted.errorClass).toBe("mock_accepted");
    expect(accepted.needsHumanConfirmation).toBe(false);

    const timeout = planLineDeliveryMockComplete(
      await createScriptedMockLineMessagingAdapter({
        timedOut: true,
        httpOk: false,
        httpStatus: null,
        localErrorClass: "timeout",
        message: "timeout",
      }).send({ deliveryKey: "k", textBody: "t" }),
    );
    expect(timeout.status).toBe("pending_confirmation");
    expect(timeout.mockAccepted).toBe(false);
    expect(timeout.sentLine).toBe(false);
    expect(timeout.needsHumanConfirmation).toBe(true);

    const unknown = planLineDeliveryMockComplete(
      await createScriptedMockLineMessagingAdapter({
        timedOut: false,
        httpOk: false,
        httpStatus: 503,
        localErrorClass: "unknown",
        message: "5xx",
      }).send({ deliveryKey: "k", textBody: "t" }),
    );
    expect(unknown.status).toBe("pending_confirmation");
    expect(unknown.sentLine).toBe(false);

    const idle = await runLineDeliveryMockWorkerTick({ claimed: null });
    expect(idle.noWork).toBe(true);
    expect(idle.sentLine).toBe(false);
    expect(idle.complete).toBeNull();

    const claimed = parseLineDeliveryClaimedTask({
      ok: true,
      id: "ldt-mock",
      delivery_key: "10:automation|14:org-the-enjoye|4:mock|6:cust-2",
      kind: "automation",
      status: "claimed",
      attempt_count: 1,
    });
    const tick = await runLineDeliveryMockWorkerTick({ claimed });
    expect(tick.noWork).toBe(false);
    expect(tick.mockAccepted).toBe(true);
    expect(tick.sentLine).toBe(false);
    expect(tick.complete?.errorClass).toBe("mock_accepted");
  });

  it("strips LINE identity fields from owner-safe records", () => {
    const mapped = mapLineDeliveryRecord({
      id: "ldt-safe",
      kind: "automation",
      created_at: "2026-10-21T00:00:00.000Z",
      status: "accepted",
      mock_accepted: true,
      last_error: "Mock adapter 接受，仍未發送真實 LINE",
      needs_human_confirmation: false,
      attempt_count: 1,
      recipient_id: "cust-2",
      delivery_key: "secret-key",
      line_user_id: "Udddddddddddddddddddddddddddddddd",
    });
    expect(mapped).toEqual({
      id: "ldt-safe",
      kind: "automation",
      createdAt: "2026-10-21T00:00:00.000Z",
      status: "accepted",
      mockAccepted: true,
      lastError: "Mock adapter 接受，仍未發送真實 LINE",
      needsHumanConfirmation: false,
      attemptCount: 1,
      sentLine: false,
    });
    expect(JSON.stringify(mapped)).not.toMatch(/recipient_id|delivery_key|line_user_id|U[A-Za-z0-9]{32}/);
    expect(lineDeliveryKindLabel("broadcast")).toBe("群發");
    expect(lineDeliveryMockAcceptedLabel(true)).toContain("未發送真實 LINE");
    expect(
      lineDeliveryRecordHasForbiddenKeys({
        recipient_id: "cust-2",
      }),
    ).toBe(true);
    expect(
      mapLineDeliveryRecords({
        records: [
          {
            id: "ldt-pending",
            kind: "broadcast",
            created_at: "2026-10-21T01:00:00.000Z",
            status: "pending_confirmation",
            mock_accepted: false,
            last_error: "timeout",
            needs_human_confirmation: true,
            attempt_count: 1,
            sent_line: false,
          },
        ],
      })[0],
    ).toMatchObject({
      needsHumanConfirmation: true,
      mockAccepted: false,
      sentLine: false,
    });
  });

  it("keeps the local Postgres worker fixtures off Preview and Production", () => {
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/20261021130000_line_delivery_worker\.sql/);
    expect(runner).toMatch(/concurrent claim_next broke broadcast quota/);
    expect(runner).toMatch(/duplicate complete was not already_complete/);
    expect(runner).toMatch(/staff claim_next did not raise unauthorized/);
    expect(runner).toMatch(/owner read records leaked identity fields/);
    expect(runner).toMatch(/claim_next resent a claimed or completed task after restart/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
  });
});
