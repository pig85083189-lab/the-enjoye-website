// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_DELIVERY_TASKS_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-tasks-local-pg.sh";
const STUB = "supabase/tests/line-delivery-tasks.local-stub.sql";
const CASES = "supabase/tests/line-delivery-tasks.local-cases.sql";

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

describe("Phase 3B LINE delivery tasks", () => {
  it("keeps the local Postgres delivery fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, STUB))).toBe(true);
    expect(existsSync(path.join(ROOT, CASES))).toBe(true);
    expect(existsSync(path.join(ROOT, LINE_DELIVERY_TASKS_MIGRATION_FILE))).toBe(true);
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/20261021120000_line_delivery_tasks\.sql/);
    expect(runner).toMatch(/20261021130000_line_delivery_worker\.sql/);
    expect(runner).toMatch(/20261021140000_line_delivery_broadcast_quota_unify\.sql/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
  });

  it("applies local delivery tasks without sending LINE", () => {
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
    expect(output).toMatch(/PASS: local LINE delivery tasks claimed without sending LINE/);
    expect(output).toMatch(
      /PASS: local LINE delivery mock worker stayed inside quota without sending LINE/,
    );
  });
});
