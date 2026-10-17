// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_BEAUTY_OS_TEST_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  compareSharedWebhookArchitectures,
  createIsolatedDatabase,
  issueIsolatedChallenge,
  recommendedSharedWebhookArchitecture,
  routeSharedChannelWebhook,
  sharedWebhookRoutingFlagsClosed,
  signIsolatedWebhookBody,
} from "@/lib/line/webhook-routing/shared-channel-router";

const ROOT = process.cwd();
function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const FAKE_USER = "U00000000000000000000000000000001";

function body(code: string, eventId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    events: [
      {
        webhookEventId: eventId,
        type: "message",
        source: { type: "user", userId: FAKE_USER },
        message: { type: "text", text: code },
        ...extra,
      },
    ],
  });
}

function route(input: {
  preview: ReturnType<typeof createIsolatedDatabase>;
  production: ReturnType<typeof createIsolatedDatabase>;
  code?: string;
  eventId?: string;
  urlOrganizationId?: string;
  signature?: string | null;
  rawBody?: string;
  previewDown?: boolean;
  productionDown?: boolean;
}) {
  if (input.previewDown) input.preview.available = false;
  if (input.productionDown) input.production.available = false;
  const rawBody = input.rawBody ?? body(input.code ?? "AABBCCDD", input.eventId ?? "evt-local-1");
  return routeSharedChannelWebhook({
    rawBody,
    signature: input.signature === undefined ? signIsolatedWebhookBody(rawBody) : input.signature,
    urlOrganizationId: input.urlOrganizationId ?? ORG_BEAUTY_OS_TEST_ID,
    preview: input.preview,
    production: input.production,
  });
}

describe("Phase 2F-5 shared webhook routing prototype", () => {
  it("routes Enjoye and TEST by challenge ownership, not URL org", () => {
    const preview = createIsolatedDatabase("preview");
    const production = createIsolatedDatabase("production");
    expect(issueIsolatedChallenge({ db: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: "11111111" })).toBeTruthy();
    expect(issueIsolatedChallenge({ db: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: "22222222" })).toBeTruthy();
    expect(issueIsolatedChallenge({ db: preview, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: "33333333" })).toBeNull();
    expect(issueIsolatedChallenge({ db: production, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: "44444444" })).toBeNull();

    const enjoye = route({
      preview,
      production,
      code: "22222222",
      eventId: "evt-enjoye-1",
      urlOrganizationId: ORG_BEAUTY_OS_TEST_ID,
    });
    expect(enjoye).toMatchObject({
      ok: true,
      bound: true,
      environment: "production",
      organizationId: ORG_ENJOYE_ID,
      staffUserId: "staff-001",
    });
    expect(production.recipients).toHaveLength(1);
    expect(preview.recipients).toHaveLength(0);

    const test = route({
      preview,
      production,
      code: "11111111",
      eventId: "evt-test-1",
      urlOrganizationId: ORG_ENJOYE_ID,
    });
    expect(test).toMatchObject({
      bound: true,
      environment: "preview",
      organizationId: ORG_BEAUTY_OS_TEST_ID,
      staffUserId: "staff-test-1",
    });
    expect(preview.recipients).toHaveLength(1);
  });

  it("rejects cross-org collision, replay, bad signature, unknown events, and down databases", () => {
    const preview = createIsolatedDatabase("preview");
    const production = createIsolatedDatabase("production");
    issueIsolatedChallenge({ db: preview, organizationId: ORG_BEAUTY_OS_TEST_ID, staffUserId: "staff-test-1", code: "ABCD1234" });
    issueIsolatedChallenge({ db: production, organizationId: ORG_ENJOYE_ID, staffUserId: "staff-001", code: "ABCD1234" });

    expect(route({ preview, production, code: "ABCD1234", eventId: "evt-collision" }).reason).toBe(
      "collision",
    );
    expect(preview.recipients).toHaveLength(0);
    expect(production.recipients).toHaveLength(0);

    const cleanPreview = createIsolatedDatabase("preview");
    const cleanProduction = createIsolatedDatabase("production");
    issueIsolatedChallenge({
      db: cleanProduction,
      organizationId: ORG_ENJOYE_ID,
      staffUserId: "staff-001",
      code: "DEADBEEF",
    });
    const first = route({
      preview: cleanPreview,
      production: cleanProduction,
      code: "DEADBEEF",
      eventId: "evt-replay",
    });
    const replay = route({
      preview: cleanPreview,
      production: cleanProduction,
      code: "DEADBEEF",
      eventId: "evt-replay",
    });
    expect(first.bound).toBe(true);
    expect(replay.reason).toBe("duplicate");
    expect(cleanProduction.recipients).toHaveLength(1);

    const raw = body("DEADBEEF", "evt-bad-sig");
    expect(
      route({
        preview: createIsolatedDatabase("preview"),
        production: createIsolatedDatabase("production"),
        rawBody: raw,
        signature: "ZmFrZXNpZ25hdHVyZQ==",
      }).reason,
    ).toBe("unauthorized");

    expect(
      route({
        preview: createIsolatedDatabase("preview"),
        production: createIsolatedDatabase("production"),
        rawBody: JSON.stringify({ events: [{ type: "follow", source: { type: "user" } }] }),
      }).reason,
    ).toBe("unknown");

    const downPreview = createIsolatedDatabase("preview");
    const downProduction = createIsolatedDatabase("production");
    issueIsolatedChallenge({
      db: downProduction,
      organizationId: ORG_ENJOYE_ID,
      staffUserId: "staff-001",
      code: "CAFEBABE",
    });
    expect(
      route({
        preview: downPreview,
        production: downProduction,
        code: "CAFEBABE",
        eventId: "evt-down",
        previewDown: true,
      }).reason,
    ).toBe("unavailable");
    expect(downProduction.recipients).toHaveLength(0);
  });

  it("recommends constrained forward, keeps TEST, and never opens send or real webhook wiring", () => {
    expect(sharedWebhookRoutingFlagsClosed()).toBe(true);
    expect(LINE_BROADCAST_SEND_OPEN).toBe(false);
    expect(recommendedSharedWebhookArchitecture()).toBe("B_constrained_forward");
    expect(compareSharedWebhookArchitectures().keepTestBind).toBe(true);
    const src = source("lib/line/webhook-routing/shared-channel-router.ts");
    expect(src).not.toMatch(/api\.line\.me|executeLineBroadcastHttp|multicast/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|BEAUTY_OS_LINE_CREDENTIAL_KEY/);
    expect(source("app/api/line/webhook/[organizationId]/[publicToken]/route.ts")).not.toMatch(
      /routeSharedChannelWebhook/,
    );
    expect(source("lib/line/line-flag.ts")).toMatch(/LINE_BROADCAST_SEND_OPEN = false/);
  });
});
