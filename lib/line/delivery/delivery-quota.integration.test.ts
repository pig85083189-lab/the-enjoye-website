// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_DELIVERY_WORKER_MIGRATION_FILE } from "@/lib/persistence/schema-contract";

const ROOT = process.cwd();
const RUNNER = "scripts/line-delivery-quota-cross-flow-local-pg.sh";

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

describe("Phase 3D LINE delivery cross-flow quota", () => {
  it("keeps the local Postgres quota fixtures off Preview and Production", () => {
    expect(existsSync(path.join(ROOT, RUNNER))).toBe(true);
    expect(existsSync(path.join(ROOT, LINE_DELIVERY_WORKER_MIGRATION_FILE))).toBe(true);
    const runner = source(RUNNER);
    expect(runner).toMatch(/unix socket/);
    expect(runner).toMatch(/20261021130000_line_delivery_worker\.sql/);
    expect(runner).not.toMatch(/claim_line_broadcast_send\(/);
    expect(runner).not.toMatch(/bfzquejrtgqzzarhkiya|knccefcxncglgpmvgqlp|api\.line\.me/);
  });

  it("counts official Broadcast rows against delivery quota without sending LINE", () => {
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
      /PASS: local LINE delivery cross-flow quota stayed closed without sending LINE/,
    );
  });
});
