import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const UI_DIRS = ["app", "components", "features"];

function walkSource(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSource(path.relative(ROOT, full)));
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
    const files = UI_DIRS.flatMap(walkSource);
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

describe("Phase 1C-4 service remote foundation UI boundary", () => {
  it("does not leave a service bootstrap endpoint", () => {
    expect(existsSync(path.join(ROOT, "app/staff/service-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "app/staff/service-bootstrap/ServiceBootstrapClient.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/staff-auth/service-bootstrap.ts"))).toBe(false);
  });

  it("does not keep temporary service bootstrap write helpers", () => {
    const files = ["app", "lib", "features", "components"].flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".isolation.test.ts")) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (
        source.includes("createFirstRemoteQaService") ||
        source.includes("SERVICE_BOOTSTRAP_ROUTE") ||
        source.includes("/staff/service-bootstrap")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not query raw service tables from React modules", () => {
    const files = UI_DIRS.flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (/\.from\(\s*["']services["']\s*\)/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the Customer remote read pilot wired", () => {
    const list = readFileSync(path.join(ROOT, "app/staff/(app)/customers/page.tsx"), "utf8");
    const detail = readFileSync(path.join(ROOT, "app/staff/(app)/customers/[id]/page.tsx"), "utf8");
    expect(list).toMatch(/isCustomerRemoteReadPilotEnabled/);
    expect(detail).toMatch(/isCustomerRemoteReadPilotEnabled/);
  });

  it("keeps Today / Calendar / Checkout / Treatment off the Service remote write path", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/AuthenticatedServiceTableStore|ServiceRemoteAdapter|createServiceRecord/);
    }
  });
});

describe("Phase 1C-5A appointment remote foundation UI boundary", () => {
  it("does not leave an appointment bootstrap endpoint", () => {
    expect(existsSync(path.join(ROOT, "app/staff/appointment-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/staff-auth/appointment-bootstrap.ts"))).toBe(false);
  });

  it("does not activate Appointment remote on live surfaces", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/customers/CustomerListPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/services/ServiceCatalogPageClient.tsx",
    ];
    for (const file of surfaces) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|createAppointmentRecord|taipeiLocalToUtcIso/,
      );
      expect(source).not.toMatch(/BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE/);
    }
  });
});

describe("Phase 1C-5C appointment remote read UI boundary", () => {
  it("keeps Calendar / Today / Treatment / Checkout on local appointment reads", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/customers/CustomerListPage.tsx",
      "features/customers/use-customer-360.ts",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /listRemotePilotAppointmentsByCustomer|getRemotePilotAppointment|useCustomerRemoteAppointments|BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT/,
      );
    }
  });

  it("cuts remote Appointment read only at Customer 360 Appointments tab", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/customers/[id]/page.tsx"), "utf8");
    const profile = readFileSync(path.join(ROOT, "features/customers/CustomerProfilePage.tsx"), "utf8");
    const tab = readFileSync(path.join(ROOT, "features/customers/tabs/AppointmentsTab.tsx"), "utf8");
    expect(page).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(profile).toMatch(/appointmentRemoteReadPilot/);
    expect(tab).toMatch(/useCustomerRemoteAppointments/);
    expect(tab).toMatch(/formatTaipeiAppointmentDisplay/);
    expect(tab).toMatch(/尚無預約紀錄/);
    expect(tab).toMatch(/無法讀取預約紀錄/);
    expect(profile).not.toMatch(/AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|createAppointmentRecord/);
    expect(tab).not.toMatch(/\.from\(\s*["']appointments["']\s*\)/);
    expect(tab).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("Phase 1C-5B appointment remote foundation UI boundary", () => {
  it("does not leave an appointment bootstrap endpoint", () => {
    expect(existsSync(path.join(ROOT, "app/staff/appointment-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "app/staff/appointment-bootstrap/AppointmentBootstrapClient.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/staff-auth/appointment-bootstrap.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/staff-auth/appointment-bootstrap.isolation.test.ts"))).toBe(false);
  });

  it("does not keep temporary appointment bootstrap write helpers", () => {
    const files = ["app", "lib", "features", "components"].flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".isolation.test.ts")) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (
        source.includes("createFirstRemoteQaAppointment") ||
        source.includes("APPOINTMENT_BOOTSTRAP_ROUTE") ||
        source.includes("/staff/appointment-bootstrap")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps live Calendar / Today off the appointment bootstrap path", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/customers/CustomerListPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
    ];
    for (const file of surfaces) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/createFirstRemoteQaAppointment|APPOINTMENT_BOOTSTRAP_ROUTE|\/staff\/appointment-bootstrap/);
    }
  });
});
