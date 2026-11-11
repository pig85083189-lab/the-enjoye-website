import { describe, expect, it } from "vitest";
import { normalizeStaffUsername, validateStaffUsername } from "./staff-username";

describe("employee username policy", () => {
  it("normalizes case and whitespace", () => {
    expect(validateStaffUsername(" YiXin_01 ")).toBe("yixin_01");
  });
  it("rejects email, spaces, short and invalid names", () => {
    for (const value of ["a", "abc@gmail.com", "yi xin", "1234", "中華", "a!".repeat(20)]) {
      expect(normalizeStaffUsername(value)).toBeNull();
    }
  });
  it("reserves privileged aliases", () => {
    expect(validateStaffUsername("admin")).toBeNull();
    expect(validateStaffUsername("owner")).toBeNull();
  });
});
