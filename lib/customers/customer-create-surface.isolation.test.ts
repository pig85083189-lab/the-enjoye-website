import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON,
  resolveCustomerListCreateSurface,
} from "./customer-create-surface";
import { CUSTOMER_REMOTE_READ_ONLY_MESSAGE } from "@/lib/persistence/authenticated-customer-read-store";

describe("Phase 1C-6C customer list create surface", () => {
  it("keeps remote-read list create disabled and off the local wizard", () => {
    expect(resolveCustomerListCreateSurface(true)).toEqual({
      mode: "remote-read-only",
      href: null,
      disabled: true,
      reason: CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON,
    });
    expect(resolveCustomerListCreateSurface(false)).toEqual({
      mode: "local-create",
      href: "/staff/customers/new",
      disabled: false,
    });
  });

  it("does not invent a customer remote-write path", () => {
    const store = readFileSync(
      path.join(process.cwd(), "lib/persistence/authenticated-customer-read-store.ts"),
      "utf8",
    );
    const list = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerListPage.tsx"),
      "utf8",
    );
    expect(store).toMatch(/insertCustomer\(\): never/);
    expect(store).toMatch(CUSTOMER_REMOTE_READ_ONLY_MESSAGE);
    expect(list).toMatch(/resolveCustomerListCreateSurface/);
    expect(list).toMatch(/data-customer-create/);
    expect(list).not.toMatch(/CUSTOMER_REMOTE_WRITE|createAuthenticatedCustomerWrite/);
  });
});
