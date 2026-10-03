import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON,
  resolveCustomerListCreateSurface,
} from "./customer-create-surface";

describe("Phase customer remote-create surface", () => {
  it("re-enables +新增客戶 only when the write pilot is on", () => {
    expect(
      resolveCustomerListCreateSurface({
        remoteReadPilot: true,
        remoteWritePilot: true,
      }),
    ).toEqual({
      mode: "remote-create",
      href: "/staff/customers/new",
      disabled: false,
    });
    expect(
      resolveCustomerListCreateSurface({
        remoteReadPilot: true,
        remoteWritePilot: false,
      }),
    ).toEqual({
      mode: "remote-read-only",
      href: null,
      disabled: true,
      reason: CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON,
    });
    expect(
      resolveCustomerListCreateSurface({
        remoteReadPilot: false,
        remoteWritePilot: false,
      }),
    ).toEqual({
      mode: "local-create",
      href: "/staff/customers/new",
      disabled: false,
    });
  });

  it("keeps the list button and new-page RSC on flag files only", () => {
    const list = readFileSync(
      path.join(process.cwd(), "features/customers/CustomerListPage.tsx"),
      "utf8",
    );
    const page = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/page.tsx"),
      "utf8",
    );
    const created = readFileSync(
      path.join(process.cwd(), "app/staff/(app)/customers/new/page.tsx"),
      "utf8",
    );
    expect(list).toMatch(/resolveCustomerListCreateSurface/);
    expect(list).toMatch(/remoteWritePilot/);
    expect(page).toMatch(/customer-remote-write-flag/);
    expect(page).not.toMatch(/customer-remote-write-pilot|AuthenticatedCustomerWriteStore/);
    expect(created).toMatch(/customer-remote-write-flag/);
    expect(created).not.toMatch(/customer-remote-write-pilot|createBrowserClient|localCustomerRepository/);
  });
});
