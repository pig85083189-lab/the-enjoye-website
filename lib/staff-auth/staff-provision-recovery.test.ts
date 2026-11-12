import { describe, expect, it } from "vitest";
import { classifyBindingRecovery } from "./staff-provision-recovery";

describe("staff account provisioning failure recovery", () => {
  it("recognizes a committed binding even when the update response was lost", () => {
    expect(classifyBindingRecovery(false, true, "new-auth-id", "new-auth-id")).toBe("bound");
  });
  it("marks an unbound staff record as unbound without deleting Auth user", () => {
    expect(classifyBindingRecovery(false, true, null, "new-auth-id")).toBe("unbound");
  });
  it("never overwrites another account binding", () => {
    expect(classifyBindingRecovery(false, true, "someone-else", "new-auth-id")).toBe("conflict");
  });
  it("does not claim success when readback fails or target disappears", () => {
    expect(classifyBindingRecovery(true, true, "new-auth-id", "new-auth-id")).toBe("unknown");
    expect(classifyBindingRecovery(false, false, null, "new-auth-id")).toBe("unknown");
  });
});
