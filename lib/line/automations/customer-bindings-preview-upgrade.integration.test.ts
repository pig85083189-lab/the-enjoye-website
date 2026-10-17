// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-customer-bindings-preview-upgrade-local-pg.sh";
const STUB = "supabase/tests/line-customer-bindings-preview-upgrade.local-stub.sql";
const CASES = "supabase/tests/line-customer-bindings-preview-upgrade.local-cases.sql";

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

describe("Preview leftover LINE customer binding upgrade", () => {
  it("keeps the local Postgres upgrade fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, STUB))).toBe(true);
    expect(existsSync(path.join(ROOT, CASES))).toBe(true);
    const runner = source(RUNNER);
    const stub = source(STUB);
    const cases = source(CASES);
    const migration = source(LINE_CUSTOMER_BINDINGS_PREVIEW_UPGRADE_MIGRATION_FILE);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/beauty_os_line_bindings_preview_upgrade_local/);
    expect(runner).toMatch(/REFUSE/);
    expect(runner).toMatch(/already recorded 160000/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
    expect(stub).toMatch(/customer_app_id text not null/);
    expect(stub).toMatch(/line_user_id_cipher text not null/);
    expect(stub).toMatch(/laj-expired/);
    expect(stub).not.toMatch(/api\.line\.me|channel_secret|SUPABASE_SERVICE_ROLE_KEY/);
    expect(cases).toMatch(/upgrade changed binding count/);
    expect(cases).toMatch(/legacy verified row became recipient_ready without new verification/);
    expect(cases).toMatch(/legacy pending row was confirmed without a new capture/);
    expect(migration).toMatch(/confirm_line_customer_binding/);
    expect(migration).toMatch(/where verified is true\s+and confirmed_at is null/);
    expect(migration).toMatch(/Do not apply on Production until Owner confirms/);
  });

  it("upgrades a local Preview leftover bind schema without sending LINE", () => {
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
    expect(output).toMatch(/PASS: local Preview leftover bindings upgraded/);
  });
});
