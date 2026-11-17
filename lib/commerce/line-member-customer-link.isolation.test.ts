import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/20261117103000_line_member_customer_link.sql"),
  "utf8",
);

describe("LINE member customer link", () => {
  it("keeps name and phone from granting stored value or rewriting history", () => {
    expect(migration).toMatch(/register_beauty_os_line_customer/);
    expect(migration).toMatch(/v_hash, null/);
    expect(migration).toMatch(/'manual_review'/);
    expect(migration).toMatch(/MULTIPLE_CUSTOMERS/);
    expect(migration).toMatch(/LINK_CONFLICT/);
    expect(migration).toMatch(/LINE_REVOKED/);
    expect(migration).toMatch(/NO_TRUSTED_ASSOCIATION/);
    expect(migration).not.toMatch(/update\s+public\.customers/i);
    expect(migration).not.toMatch(/update\s+public\.stored_value/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.customers/i);
    expect(migration).not.toMatch(/drop\s+table/i);
    expect(migration).not.toMatch(/stored_value_ledger_entries/);
  });

  it("passes the isolated registration cases on local PostgreSQL", () => {
    const result = spawnSync("bash", ["supabase/tests/line-member-customer-link.local.sh"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/isolated cases passed/);
  });
});
