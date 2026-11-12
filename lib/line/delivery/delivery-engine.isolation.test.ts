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
  classifyLineDeliveryAdapterResult,
  lineDeliveryTaskId,
  runLineDeliveryEngine,
  type LineDeliveryLedger,
  type LineDeliveryTask,
} from "@/lib/line/delivery/delivery-engine";
import {
  createMockLineMessagingAdapter,
  createScriptedMockLineMessagingAdapter,
  LINE_DELIVERY_ADAPTER_KIND,
} from "@/lib/line/delivery/delivery-adapter";
import { lineDeliveryKey } from "@/lib/line/delivery/delivery-key";
import type { DeliveryCandidate } from "@/lib/line/delivery/delivery-plan";
import {
  evaluateLineDeliveryRecipient,
  type LineDeliveryRecipientSnapshot,
} from "@/lib/line/delivery/delivery-recipient";
import { LINE_BROADCAST_SEND_OPEN, LINE_TEST_PUSH_OPEN } from "@/lib/line/line-flag";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const trusted: LineDeliveryRecipientSnapshot = {
  organizationId: "org-the-enjoye",
  customerId: "cust-1",
  verified: true,
  status: "active",
  confirmedAt: "2026-10-21T00:00:00.000Z",
  capturedAt: "2026-10-21T00:00:00.000Z",
  bindMethod: "webhook_code",
  hasSecret: true,
  customerStatus: "ACTIVE",
};

const candidate: DeliveryCandidate = {
  kind: "automation",
  organizationId: "org-the-enjoye",
  deliveryId: "appointment-1:day_before_morning",
  recipientId: "cust-1",
  message: "預約提醒",
  recipientVerified: true,
  recipientConsented: true,
  scheduledAtMs: 1000,
};

function throwingAdapter() {
  return {
    kind: LINE_DELIVERY_ADAPTER_KIND,
    async send(): Promise<never> {
      throw new Error("adapter must not be called while send gates are closed");
    },
  };
}

describe("LINE delivery engine foundation", () => {
  it("keeps every send gate closed and never mentions a live LINE origin", () => {
    expect(LINE_AUTOMATION_SEND_OPEN).toBe(false);
    expect(LINE_OWNER_SELF_PUSH_OPEN).toBe(false);
    expect(LINE_AUTOMATION_KILL_SWITCH).toBe(false);
    expect(LINE_OWNER_SELF_GRANT_PERSIST_OPEN).toBe(false);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(LINE_TEST_PUSH_OPEN).toBe(false);

    const files = [
      "lib/line/delivery/delivery-plan.ts",
      "lib/line/delivery/delivery-key.ts",
      "lib/line/delivery/delivery-recipient.ts",
      "lib/line/delivery/delivery-adapter.ts",
      "lib/line/delivery/delivery-engine.ts",
    ];
    const joined = files.map(source).join("\n");
    expect(joined).not.toMatch(/https:\/\/api\.line\.me|\/v2\/bot\/message/);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/executeLineBroadcastHttp|executeLineTestPushHttp/);
    expect(joined).not.toMatch(/LINE_AUTOMATION_SEND_OPEN = true|LINE_BROADCAST_SEND_OPEN = true/);
    expect(joined).not.toMatch(/pg_cron|cron\.schedule/);
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
    expect(source("lib/line/automations/production-safe-flags.ts")).toMatch(
      /LINE_AUTOMATION_SEND_OPEN = false/,
    );
  });

  it("builds a unique delivery key for broadcast and automation without collisions", () => {
    const automation = lineDeliveryKey({
      kind: "automation",
      organizationId: "org-a",
      deliveryId: "event|1",
      recipientId: "cust:1",
    });
    const broadcast = lineDeliveryKey({
      kind: "broadcast",
      organizationId: "org-a",
      deliveryId: "event|1",
      recipientId: "cust:1",
    });
    const shifted = lineDeliveryKey({
      kind: "automation",
      organizationId: "org-a|event",
      deliveryId: "1",
      recipientId: "cust:1",
    });
    expect(automation).toBe("10:automation|5:org-a|7:event|1|6:cust:1");
    expect(broadcast).not.toBe(automation);
    expect(shifted).not.toBe(automation);
    expect(lineDeliveryKey({ ...candidate, organizationId: "  " })).toBeNull();
  });

  it("rechecks trusted LINE binding at send time and ignores scheduled job status", () => {
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: trusted,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: { ...trusted, verified: true, confirmedAt: null },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: { ...trusted, hasSecret: false },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: { ...trusted, capturedAt: null },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: { ...trusted, organizationId: "org-other" },
      }).ok,
    ).toBe(false);
    expect(
      evaluateLineDeliveryRecipient({
        organizationId: "org-the-enjoye",
        recipientId: "cust-1",
        snapshot: { ...trusted, customerStatus: "INACTIVE" },
      }).ok,
    ).toBe(false);
  });

  it("records a blocked automation task without calling the mock adapter", async () => {
    const ledger: LineDeliveryLedger = new Map();
    const result = await runLineDeliveryEngine({
      candidate,
      recipient: trusted,
      ledger,
      nowMs: 2000,
      adapter: throwingAdapter(),
    });
    expect(result.decision).toBe("blocked_send_closed");
    expect(result.sentLine).toBe(false);
    expect(result.adapterCalled).toBe(false);
    expect(result.task?.status).toBe("blocked");
    expect(result.task?.retryable).toBe(false);
    expect(result.task?.deliveryKey).toBe(lineDeliveryKey(candidate));
    expect(result.task?.id).toBe(lineDeliveryTaskId(result.task!.deliveryKey));
    expect(ledger.size).toBe(1);
  });

  it("blocks automation when send-time binding is not trusted, even if the planner candidate looks verified", async () => {
    const ledger: LineDeliveryLedger = new Map();
    const result = await runLineDeliveryEngine({
      candidate,
      recipient: { ...trusted, hasSecret: false },
      ledger,
      nowMs: 2000,
      adapter: throwingAdapter(),
    });
    expect(result.decision).toBe("recipient_not_ready");
    expect(result.sentLine).toBe(false);
    expect(result.adapterCalled).toBe(false);
    expect(result.task?.lastErrorClass).toBe("recipient_not_ready");
  });

  it("refuses a second send when a task is already claimed or pending confirmation", async () => {
    const deliveryKey = lineDeliveryKey(candidate)!;
    const claimed: LineDeliveryTask = {
      id: lineDeliveryTaskId(deliveryKey),
      deliveryKey,
      kind: "automation",
      organizationId: candidate.organizationId,
      deliveryId: candidate.deliveryId,
      recipientId: candidate.recipientId,
      status: "pending_confirmation",
      decision: "ready_for_review",
      attemptCount: 1,
      retryable: false,
      lastError: "timeout",
      lastErrorClass: "timeout",
      sentLine: false,
      updatedAtMs: 1500,
    };
    const ledger: LineDeliveryLedger = new Map([[deliveryKey, claimed]]);
    const result = await runLineDeliveryEngine({
      candidate,
      recipient: trusted,
      ledger,
      nowMs: 3000,
      adapter: throwingAdapter(),
    });
    expect(result.decision).toBe("blocked_duplicate");
    expect(result.adapterCalled).toBe(false);
    expect(result.sentLine).toBe(false);
    expect(ledger.get(deliveryKey)?.attemptCount).toBe(1);
  });

  it("never lets the mock adapter touch the network", async () => {
    const closed = await createMockLineMessagingAdapter().send({
      deliveryKey: "10:automation|3:org|3:job|4:cust",
      textBody: "hello",
    });
    expect(closed.adapter).toBe("mock");
    expect(closed.sentLine).toBe(false);
    expect(closed.httpOk).toBe(false);
    expect(closed.lineRequestId).toBeNull();
    expect(closed.localErrorClass).toBe("send_closed");

    const scripted = await createScriptedMockLineMessagingAdapter({
      timedOut: true,
      httpOk: false,
      httpStatus: null,
      localErrorClass: "timeout",
      message: "simulated timeout",
    }).send({
      deliveryKey: "key",
      textBody: "hello",
    });
    expect(scripted.sentLine).toBe(false);
    expect(scripted.lineRequestId).toBeNull();
  });

  it("classifies failures as non-retryable and treats timeout/unknown as pending confirmation", () => {
    expect(
      classifyLineDeliveryAdapterResult({
        adapter: "mock",
        sentLine: false,
        timedOut: true,
        httpOk: false,
        httpStatus: null,
        lineRequestId: null,
        localErrorClass: "timeout",
        message: "timeout",
      }),
    ).toMatchObject({ status: "pending_confirmation", retryable: false, errorClass: "timeout" });
    expect(
      classifyLineDeliveryAdapterResult({
        adapter: "mock",
        sentLine: false,
        timedOut: false,
        httpOk: false,
        httpStatus: 503,
        lineRequestId: null,
        localErrorClass: "unknown",
        message: "unknown",
      }),
    ).toMatchObject({ status: "pending_confirmation", retryable: false, errorClass: "unknown" });
    expect(
      classifyLineDeliveryAdapterResult({
        adapter: "mock",
        sentLine: false,
        timedOut: false,
        httpOk: false,
        httpStatus: 400,
        lineRequestId: null,
        localErrorClass: "invalid_request",
        message: "invalid",
      }),
    ).toMatchObject({ status: "failed", retryable: false, errorClass: "invalid_request" });
    expect(
      classifyLineDeliveryAdapterResult({
        adapter: "mock",
        sentLine: false,
        timedOut: false,
        httpOk: false,
        httpStatus: null,
        lineRequestId: null,
        localErrorClass: "send_closed",
        message: "closed",
      }),
    ).toMatchObject({ status: "blocked", retryable: false, errorClass: "send_closed" });
  });

  it("uses the same blocked path for broadcast candidates and still does not send", async () => {
    const ledger: LineDeliveryLedger = new Map();
    const result = await runLineDeliveryEngine({
      candidate: { ...candidate, kind: "broadcast", deliveryId: "broadcast-1" },
      recipient: null,
      ledger,
      nowMs: 2000,
      adapter: throwingAdapter(),
    });
    expect(result.decision).toBe("blocked_send_closed");
    expect(result.sentLine).toBe(false);
    expect(result.adapterCalled).toBe(false);
    expect(result.task?.kind).toBe("broadcast");
  });
});
