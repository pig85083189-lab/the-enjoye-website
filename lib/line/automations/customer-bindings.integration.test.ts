// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_CUSTOMER_BINDINGS_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-customer-bindings-local-pg.sh";
const STUB = "supabase/tests/line-customer-bindings.local-stub.sql";
const CASES = "supabase/tests/line-customer-bindings.local-cases.sql";

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function localPostgresReady(): boolean {
  if (process.env.PGHOST || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
    return false;
  }
  try {
    execFileSync("pg_isready", ["-q"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("Phase 2B LINE customer bindings", () => {
  it("keeps the local Postgres binding fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, STUB))).toBe(true);
    expect(existsSync(path.join(ROOT, CASES))).toBe(true);
    const runner = source(RUNNER);
    const stub = source(STUB);
    const cases = source(CASES);
    const migration = source(LINE_CUSTOMER_BINDINGS_MIGRATION_FILE);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_customer_bindings_local/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(stub).toMatch(/is_operational_staff_id/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);
    expect(cases).toMatch(/cross-org customer bind was accepted/);
    expect(cases).toMatch(/forged LINE identity was accepted/);
    expect(cases).toMatch(/duplicate LINE identity was accepted/);
    expect(cases).toMatch(/unbind left a verified secret/);
    expect(cases).toMatch(/Phase 2B appointment job was not preserved after customer bindings/);
    expect(cases).toMatch(/new job without trusted binding was scheduled/);
    expect(migration).toMatch(/consume_line_customer_bind_challenge_public/);
    expect(migration).toMatch(/line_automation_schedule_recipient_ready/);
    expect(migration).not.toMatch(/api\.line\.me|pg_cron/);
    expect(migration).toMatch(/Do not apply on Production until Owner confirms/);
  });

  it("applies local customer bindings without sending LINE", () => {
    if (!localPostgresReady()) {
      expect(localPostgresReady(), "local unix-socket PostgreSQL is required").toBe(true);
      return;
    }
    const output = execFileSync("bash", [path.join(ROOT, RUNNER)], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: "",
        PGPORT: "",
        DATABASE_URL: "",
        SUPABASE_DB_URL: "",
      },
    });
    expect(output).toMatch(/PASS: local LINE customer bindings/);
  });
});
