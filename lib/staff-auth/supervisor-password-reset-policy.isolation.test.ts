import { strict as assert } from "node:assert";
import { test } from "node:test";
import { authorizeSupervisorPasswordReset, validateSupervisorPassword } from "./supervisor-password-reset-policy";

const base = {
  actorAuthUserId: "actor-1",
  actorRole: "MANAGER" as const,
  actorActive: true,
  actorOrganizationId: "org-1",
  targetAuthUserId: "target-1",
  targetRole: "STAFF" as const,
  targetActive: true,
  targetOrganizationId: "org-1",
};

test("active manager may reset bound staff in same organization", () => {
  assert.deepEqual(authorizeSupervisorPasswordReset(base), { allowed: true });
});
test("rejects cross-org, inactive, unbound and self-target", () => {
  for (const patch of [
    { targetOrganizationId: "org-2" },
    { actorActive: false },
    { targetActive: false },
    { targetAuthUserId: null },
    { targetAuthUserId: "actor-1" },
    { actorAuthUserId: null },
  ]) {
    assert.equal(authorizeSupervisorPasswordReset({ ...base, ...patch }).allowed, false);
  }
});
test("manager cannot reset owner or manager; owner cannot reset owner", () => {
  for (const targetRole of ["OWNER", "MANAGER"] as const) {
    assert.equal(authorizeSupervisorPasswordReset({ ...base, targetRole }).allowed, false);
  }
  assert.equal(authorizeSupervisorPasswordReset({ ...base, actorRole: "OWNER", targetRole: "OWNER" }).allowed, false);
  assert.equal(authorizeSupervisorPasswordReset({ ...base, actorRole: "OWNER", targetRole: "MANAGER" }).allowed, true);
});
test("staff cannot reset other users", () => {
  assert.equal(authorizeSupervisorPasswordReset({ ...base, actorRole: "STAFF" }).allowed, false);
});
test("requires sufficiently strong passwords", () => {
  assert.equal(validateSupervisorPassword("StrongPassword2026"), true);
  assert.equal(validateSupervisorPassword("short1"), false);
  assert.equal(validateSupervisorPassword("onlyletterslong"), false);
  assert.equal(validateSupervisorPassword("123456789012"), false);
});
