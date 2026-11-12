// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-quota-unify-local-pg.sh";

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

describe("Phase 3E LINE delivery Broadcast quota unify", () => {
  it("keeps the local Postgres unify fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, LINE_DELIVERY_BROADCAST_QUOTA_UNIFY_MIGRATION_FILE))).toBe(true);
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/20261021140000_line_delivery_broadcast_quota_unify\.sql/);
    expect(runner).toMatch(/claim_line_broadcast_send\(/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
  });

  it("runs official and delivery claims together without sending LINE", () => {
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
    expect(output).toMatch(
      /PASS: local LINE delivery quota unify kept official\+delivery inside 3 without sending LINE/,
    );
  });
});
