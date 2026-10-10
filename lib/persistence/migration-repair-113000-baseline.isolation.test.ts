import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_MIGRATION_DEFECTIVE_SHA256,
  OPERATIONAL_MIGRATION_FILE,
  OPERATIONAL_MIGRATION_REPAIRED_SHA256,
} from "./schema-contract";

/**
 * Evidence for why `migration-repair-113000.isolation.test.ts` can fail
 * against the current origin/main checkout. That original test is kept.
 *
 * Historical contract: origin/main 113000 === DEFECTIVE
 * `2c01751cdbcef8294d16b0cb580c17948ce9598528bb0e7ca4dada0ff1a24618`
 *
 * After later main landing of the replay repair, origin/main may already
 * equal REPAIRED
 * `baa230a5f4aa44d506aa811e3350cbf39265ce56d1083aba56a1c8ace65911f5`.
 *
 * Reproduce:
 *   git show origin/main:supabase/migrations/20260928113000_beauty_os_operational_foundation.sql | sha256sum
 *   git rev-parse origin/main
 *   git log -1 --oneline origin/main -- supabase/migrations/20260928113000_beauty_os_operational_foundation.sql
 */
function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("Phase 1C-6H.2P2B 113000 origin/main baseline evidence", () => {
  const main = execSync(`git show origin/main:${OPERATIONAL_MIGRATION_FILE}`, {
    encoding: "utf8",
  });
  const mainHash = sha256Text(main);
  const originMain = execSync("git rev-parse origin/main", {
    encoding: "utf8",
  }).trim();
  const fileLog = execSync(
    `git log -1 --format=%H:%s origin/main -- ${OPERATIONAL_MIGRATION_FILE}`,
    { encoding: "utf8" },
  ).trim();

  it("records the current origin/main 113000 hash without deleting the original contract", () => {
    expect(OPERATIONAL_MIGRATION_DEFECTIVE_SHA256).toBe(
      "2c01751cdbcef8294d16b0cb580c17948ce9598528bb0e7ca4dada0ff1a24618",
    );
    expect(OPERATIONAL_MIGRATION_REPAIRED_SHA256).toBe(
      "baa230a5f4aa44d506aa811e3350cbf39265ce56d1083aba56a1c8ace65911f5",
    );
    expect([
      OPERATIONAL_MIGRATION_DEFECTIVE_SHA256,
      OPERATIONAL_MIGRATION_REPAIRED_SHA256,
    ]).toContain(mainHash);

    const mainMatchesDefective = mainHash === OPERATIONAL_MIGRATION_DEFECTIVE_SHA256;
    const mainMatchesRepaired = mainHash === OPERATIONAL_MIGRATION_REPAIRED_SHA256;

    if (mainMatchesRepaired && !mainMatchesDefective) {
      expect({
        originMain,
        fileLog,
        mainHash,
        originalTestAssumption: "origin/main === DEFECTIVE",
        currentBaseline: "origin/main === REPAIRED",
        originalTestFile: "lib/persistence/migration-repair-113000.isolation.test.ts",
        reason:
          "main already contains the qualified audit_logs_insert_org repair. The original contract still expects the defective published hash so reviewers can see the baseline moved; do not skip or delete it.",
      }).toMatchObject({
        currentBaseline: "origin/main === REPAIRED",
        mainHash: OPERATIONAL_MIGRATION_REPAIRED_SHA256,
      });
    } else {
      expect(mainHash).toBe(OPERATIONAL_MIGRATION_DEFECTIVE_SHA256);
    }
  });
});
