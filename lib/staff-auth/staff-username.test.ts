import { describe, expect, it } from "vitest";
import { normalizeStaffUsername, validateStaffUsername, staffUsernameAuthEmail } from "./staff-username";

describe("employee username policy", () => {
  it("normalizes case and whitespace", () => {
    expect(validateStaffUsername(" YiXin_01 ")).toBe("yixin_01");
  });
  it("rejects email, spaces, short and invalid names", () => {
    for (const value of ["a", "abc@gmail.com", "yi xin", "中華", "a!".repeat(20)]) {
      expect(normalizeStaffUsername(value)).toBeNull();
    }
  });
  it("maps normalized employee names to the same internal Auth identity", () => {
    expect(staffUsernameAuthEmail(" YiXin_01 ")).toBe("yixin_01@staff-login.the-enjoye.invalid");
    expect(staffUsernameAuthEmail("yixin_01")).toBe("yixin_01@staff-login.the-enjoye.invalid");
    expect(staffUsernameAuthEmail("pig85083189@gmail.com")).toBeNull();
  });
  it("does not accept reserved names as Auth aliases", () => {
    expect(staffUsernameAuthEmail("admin")).toBeNull();
  });
  it("reserves privileged aliases", () => {
    expect(validateStaffUsername("admin")).toBeNull();
    expect(validateStaffUsername("owner")).toBeNull();
    expect(validateStaffUsername("1234")).toBe("1234");
  });
});
