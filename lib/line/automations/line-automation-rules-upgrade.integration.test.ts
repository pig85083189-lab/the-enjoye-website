// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_AUTOMATION_RULES_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-automation-rules-phase2b-upgrade-local-pg.sh";
const STUB = "supabase/tests/line-automation-rules-phase2b-upgrade.local-stub.sql";
const CASES = "supabase/tests/line-automation-rules-phase2b-upgrade.local-cases.sql";

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

describe("Phase 2B to Phase 1 line_automation_rules upgrade", () => {
  it("keeps the local Postgres upgrade fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, STUB))).toBe(true);
    expect(existsSync(path.join(ROOT, CASES))).toBe(true);
    const runner = source(RUNNER);
    const stub = source(STUB);
    const cases = source(CASES);
    const migration = source(LINE_AUTOMATION_RULES_MIGRATION_FILE);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_rules_upgrade_local/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(stub).toMatch(/user_operational_staff_id\(target_org uuid\)/);
    expect(stub).toMatch(/automation_id = 'appointment_reminder'/);
    expect(stub).toMatch(/upsert_line_appointment_reminder_rule/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);
    expect(cases).toMatch(/backfill overwrote existing template/);
    expect(cases).toMatch(/customTimings were not stored|customTimings/);
    expect(cases).toMatch(/Phase 2B sync did not see the re-enabled shared rule/);
    expect(migration).toMatch(/Fail the migration immediately if either unique cannot be created/);
  });

  it("upgrades a local Phase 2B table and shares one appointment reminder row", () => {
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
    expect(output).toMatch(/PASS: local Phase 2B schema upgraded to Phase 1/);
  });
});
