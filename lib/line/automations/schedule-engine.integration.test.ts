// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-automation-schedule-engine-local-pg.sh";
const STUB = "supabase/tests/line-automation-schedule-engine.local-stub.sql";
const CASES = "supabase/tests/line-automation-schedule-engine.local-cases.sql";

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

describe("Phase 2A line_automation_jobs upgrade", () => {
  it("keeps the local Postgres schedule fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, STUB))).toBe(true);
    expect(existsSync(path.join(ROOT, CASES))).toBe(true);
    const runner = source(RUNNER);
    const stub = source(STUB);
    const cases = source(CASES);
    const migration = source(LINE_AUTOMATION_SCHEDULE_MIGRATION_FILE);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_schedule_upgrade_local/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(stub).toMatch(/appointment_app_id text not null/);
    expect(stub).toMatch(/timing_id in \('day_before_morning', 'hours_before_3'\)/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);
    expect(cases).toMatch(/duplicate birthday job created/);
    expect(cases).toMatch(/accepted job was mutated|accepted job was resent/);
    expect(migration).toMatch(/line_automation_jobs_active_fingerprint_key/);
    expect(migration).toMatch(/Do not apply on Production until Owner confirms/);
  });

  it("upgrades a local Phase 2B jobs table and applies schedule mutations without sending LINE", () => {
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
    expect(output).toMatch(/PASS: local Phase 2B jobs upgraded to Phase 2A/);
  });
});
