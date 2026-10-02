import { describe, expect, it } from "vitest";
import {
  getOperationalPersistence,
  getPersistenceDriver,
  isSupabasePersistenceEnabled,
} from "./index";
import { REMOTE_FLAGS } from "./remote-factory";

describe("Phase 1B persistence driver truth table", () => {
  it("no flags → local", () => {
    expect(getPersistenceDriver({})).toBe("local");
    expect(isSupabasePersistenceEnabled({})).toBe(false);
    expect(getOperationalPersistence({}).driver).toBe("local");
  });

  it("only BEAUTY_OS_PERSISTENCE=supabase → local", () => {
    expect(getPersistenceDriver({ BEAUTY_OS_PERSISTENCE: "supabase" })).toBe("local");
  });

  it("only ALLOW_REMOTE=1 → local", () => {
    expect(
      getPersistenceDriver({ BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1" }),
    ).toBe("local");
  });

  it("both flags → supabase", () => {
    expect(getPersistenceDriver(REMOTE_FLAGS)).toBe("supabase");
    expect(getOperationalPersistence(REMOTE_FLAGS).driver).toBe("supabase");
  });

  it("invalid values → local", () => {
    expect(getPersistenceDriver({ BEAUTY_OS_PERSISTENCE: "postgres" })).toBe("local");
    expect(
      getPersistenceDriver({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "true",
      }),
    ).toBe("local");
    expect(
      getPersistenceDriver({
        BEAUTY_OS_PERSISTENCE: "supabase",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "yes",
      }),
    ).toBe("local");
    expect(
      getPersistenceDriver({
        BEAUTY_OS_PERSISTENCE: "unknown",
        BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE: "1",
      }),
    ).toBe("local");
    expect(getPersistenceDriver({ BEAUTY_OS_PERSISTENCE: "" })).toBe("local");
  });
});
