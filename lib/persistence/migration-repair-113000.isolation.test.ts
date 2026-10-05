import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_MIGRATION_DEFECTIVE_SHA256,
  OPERATIONAL_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_REPAIRED_SHA256,
  OPERATIONAL_MIGRATION_REPAIR_DOC,
  STRATEGY_B_RLS_MIGRATION_FILE,
} from "./schema-contract";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function sha256(rel: string): string {
  return createHash("sha256").update(read(rel)).digest("hex");
}

function policyBlock(sql: string): string {
  const start = sql.lastIndexOf("create policy audit_logs_insert_org");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("create policy audit_logs_select_managers", start));
}

describe("Phase 1C-6H.2P2B published 113000 replay repair", () => {
  const operational = read(OPERATIONAL_MIGRATION_FILE);
  const main = execSync(`git show origin/main:${OPERATIONAL_MIGRATION_FILE}`, {
    encoding: "utf8",
  });
  const policy = policyBlock(operational);
  const mainPolicy = policyBlock(main);

  it("documents the defective hash, corrected hash, and reason", () => {
    expect(existsSync(path.join(process.cwd(), OPERATIONAL_MIGRATION_REPAIR_DOC))).toBe(
      true,
    );
    const doc = read(OPERATIONAL_MIGRATION_REPAIR_DOC);
    expect(doc).toContain(OPERATIONAL_MIGRATION_DEFECTIVE_SHA256);
    expect(doc).toContain(OPERATIONAL_MIGRATION_REPAIRED_SHA256);
    expect(doc).toContain(
      "published migration was not replayable on fresh PostgreSQL 16",
    );
    expect(doc).toContain("audit_logs.organization_id");
    expect(doc).toContain("Do **not** replay this repair onto Preview history.");
    expect(sha256(OPERATIONAL_MIGRATION_FILE)).toBe(
      OPERATIONAL_MIGRATION_REPAIRED_SHA256,
    );
    expect(createHash("sha256").update(main).digest("hex")).toBe(
      OPERATIONAL_MIGRATION_DEFECTIVE_SHA256,
    );
  });

  it("only qualifies the replay-blocking audit_logs insert policy", () => {
    expect(operational).not.toBe(main);
    expect(policy).toMatch(/user_has_org_membership\(audit_logs\.organization_id\)/);
    expect(policy).toMatch(/audit_logs\.actor_id is null/);
    expect(policy).toMatch(/o\.id = audit_logs\.organization_id/);
    expect(policy).toMatch(/m\.user_id = audit_logs\.actor_id/);
    expect(policy).not.toMatch(/o\.id\s*=\s*organization_id\b/);
    expect(policy).not.toMatch(/m\.user_id\s*=\s*actor_id\b/);
    expect(mainPolicy).toMatch(/o\.id = organization_id/);
    expect(mainPolicy).toMatch(/m\.user_id = actor_id/);
    const stripped = operational
      .replace(policy, "")
      .replace(/\s+/g, " ");
    const strippedMain = main
      .replace(mainPolicy, "")
      .replace(/\s+/g, " ");
    expect(stripped).toBe(strippedMain);
  });

  it("does not introduce operator, cast, or RLS bypass hacks", () => {
    expect(operational).not.toMatch(/create operator/i);
    expect(policy).not.toMatch(/::text|::uuid/);
    expect(operational).not.toMatch(/disable row level security/i);
    expect(operational).not.toMatch(/\bdrop table\b/i);
  });

  it("keeps Strategy B as the final qualified audit_logs / helper definition", () => {
    const additive = read(STRATEGY_B_RLS_MIGRATION_FILE);
    expect(additive).toMatch(/m\.user_id = audit_logs\.actor_id/);
    expect(additive).toMatch(/o\.id = audit_logs\.organization_id/);
    expect(additive).toMatch(/create or replace function public\.current_organization_id\(\)/);
    expect(additive).toMatch(/select count\(\*\)/);
    expect(additive).not.toMatch(/min\(\s*o\.id\s*\)/);
  });
});
