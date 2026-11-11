import { describe, expect, it } from "vitest";
import { resolveStaffRecoveryRedirect } from "./staff-recovery-redirect";

const prod = "https://knccefcxncglgpmvgqlp.supabase.co";
const test = "https://bfzquejrtgqzzarhkiya.supabase.co";
const live = "https://the-enjoye-website.vercel.app";

describe("staff recovery redirect isolation", () => {
  it("uses the canonical production callback", () => {
    expect(resolveStaffRecoveryRedirect({ supabaseUrl: prod, browserOrigin: live })).toEqual({
      ok: true,
      redirectTo: live + "/staff/auth/callback?next=/staff/auth/setup-password&flow=recovery",
    });
  });
  it("rejects localhost, preview and unknown origins on production", () => {
    for (const browserOrigin of [
      "http://localhost:3000",
      "https://preview.example.vercel.app",
      "https://the-enjoye-website-git-main-pig85083189-6631s-projects.vercel.app",
    ]) {
      expect(resolveStaffRecoveryRedirect({ supabaseUrl: prod, browserOrigin })).toMatchObject({ ok: false });
    }
  });
  it("keeps preview callback on preview and rejects production cross-use", () => {
    expect(resolveStaffRecoveryRedirect({ supabaseUrl: test, browserOrigin: "https://preview.example.vercel.app" })).toMatchObject({
      ok: true,
      redirectTo: "https://preview.example.vercel.app/staff/auth/callback?next=/staff/auth/setup-password&flow=recovery",
    });
    expect(resolveStaffRecoveryRedirect({ supabaseUrl: test, browserOrigin: live })).toMatchObject({ ok: false });
  });
  it("rejects malformed and unknown project URLs", () => {
    expect(resolveStaffRecoveryRedirect({ supabaseUrl: prod, browserOrigin: "invalid" })).toMatchObject({ ok: false });
    expect(resolveStaffRecoveryRedirect({ supabaseUrl: "https://unknown.supabase.co", browserOrigin: live })).toMatchObject({ ok: false });
  });
});
