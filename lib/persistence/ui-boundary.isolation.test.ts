import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const UI_DIRS = ["app", "components", "features"];

function walkTsx(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsx(path.relative(ROOT, full)));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(path.relative(ROOT, full));
    }
  }
  return out;
}

describe("Phase 1B UI persistence boundary", () => {
  it("does not query customers or appointments from React modules", () => {
    const files = UI_DIRS.flatMap(walkTsx);
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (/\.from\(\s*["']customers["']\s*\)/.test(source)) offenders.push(`${file}:customers`);
      if (/\.from\(\s*["']services["']\s*\)/.test(source)) offenders.push(`${file}:services`);
      if (/\.from\(\s*["']appointments["']\s*\)/.test(source)) offenders.push(`${file}:appointments`);
    }
    expect(offenders).toEqual([]);
  });

  it("does not leave a customer bootstrap endpoint", () => {
    expect(existsSync(path.join(ROOT, "app/staff/customer-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/staff-auth/customer-bootstrap.ts"))).toBe(false);
  });
});

describe("Phase 1C-3 customer remote read UI boundary", () => {
  it("keeps Today / Calendar / Treatment / Checkout on local customer reads", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/listRemotePilotCustomers|getRemotePilotCustomer|useCustomerRemoteList|useCustomerRemoteDetail/);
      expect(source).not.toMatch(/BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT/);
    }
  });

  it("does not query raw customer tables from Customer list/detail UI", () => {
    const files = [
      "features/customers/CustomerListPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
      "features/customers/use-customer-remote-read.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/\.from\(\s*["']customers["']\s*\)/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});
