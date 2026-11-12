// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = join(process.cwd(), "supabase", "migrations");
const original = readFileSync(join(migrations, "20261012120000_line_broadcast_channel_lock.sql"), "utf8");
const unified = readFileSync(join(migrations, "20261021140000_line_delivery_broadcast_quota_unify.sql"), "utf8");

describe("Phase 3 broadcast quota migration static compatibility contract", () => {
  it("retains the eight-argument broadcast claim RPC instead of dropping it", () => {
    const signature = /create or replace function public\.claim_line_broadcast_send\s*\(/i;
    expect(original).toMatch(signature);
    expect(unified).toMatch(signature);
    expect(unified).toMatch(/comment on function public\.claim_line_broadcast_send\(text, text, text, text, text, boolean, integer, timestamptz\)/i);
    expect(unified).not.toMatch(/drop\s+function\s+(?:if\s+exists\s+)?public\.claim_line_broadcast_send/i);
  });

  it("preserves shared quota and claim locking protections", () => {
    expect(unified).toMatch(/line_broadcast_take_shared_quota_locks/i);
    expect(unified).toMatch(/line_broadcast_shared_quota_used/i);
    expect(unified).toMatch(/line_broadcast_campaign_mapping_ambiguous/i);
    expect(unified).toMatch(/line_delivery_key_segment/i);
  });

  it("does not enable outbound LINE sending or scheduling", () => {
    expect(unified).not.toMatch(/(?:net\.http_post|api\.line\.me|cron\.schedule|pg_cron\.schedule)/i);
  });
});
