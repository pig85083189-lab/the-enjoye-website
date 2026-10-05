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
  it("keeps Today / Calendar / Checkout on local customer reads", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/calendar/CalendarPage.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/listRemotePilotCustomers|getRemotePilotCustomer|useCustomerRemoteList|useCustomerRemoteDetail/);
      expect(source).not.toMatch(/BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT/);
    }
  });

  it("keeps Treatment customer identity on the Customer remote-read flag file", () => {
    for (const file of [
      "app/staff/(app)/treatments/new/page.tsx",
      "app/staff/(app)/treatments/page.tsx",
      "app/staff/(app)/treatments/[id]/page.tsx",
    ]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).toMatch(/isCustomerRemoteReadPilotEnabled/);
      expect(source).not.toMatch(/customer-remote-read-pilot|createAuthenticatedCustomerReadPersistence/);
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("does not query raw customer tables from Customer list/detail UI", () => {
    const files = [
      "features/customers/CustomerListPage.tsx",
      "features/customers/CustomerProfilePage.tsx",
      "features/customers/use-customer-remote-read.ts",
      "features/customers/ConsultationWizard.tsx",
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

  it("keeps Customer RSC off the customer write factory", () => {
    for (const file of [
      "app/staff/(app)/customers/page.tsx",
      "app/staff/(app)/customers/new/page.tsx",
      "app/staff/(app)/customers/[id]/page.tsx",
    ]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /customer-remote-write-pilot|AuthenticatedCustomerWriteStore|runAuthenticatedCustomerWriteCreate/,
      );
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
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
  it("keeps Today / Treatment / Checkout on local appointment reads", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
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

  it("keeps Calendar off the Customer 360 appointment remote hook", () => {
    const source = readFileSync(path.join(ROOT, "features/calendar/CalendarPage.tsx"), "utf8");
    expect(source).not.toMatch(
      /listRemotePilotAppointmentsByCustomer|getRemotePilotAppointment|useCustomerRemoteAppointments|BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT/,
    );
  });

  it("cuts remote Appointment read only at Customer 360 Appointments tab", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/customers/[id]/page.tsx"), "utf8");
    const profile = readFileSync(path.join(ROOT, "features/customers/CustomerProfilePage.tsx"), "utf8");
    const tab = readFileSync(path.join(ROOT, "features/customers/tabs/AppointmentsTab.tsx"), "utf8");
    expect(page).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(page).toMatch(/appointment-remote-read-flag/);
    expect(page).not.toMatch(/appointment-remote-read-pilot/);
    expect(page).not.toMatch(/appointment-read-diagnostic|customer-profile-isolation/);
    expect(profile).toMatch(/appointmentRemoteReadPilot/);
    expect(tab).toMatch(/useCustomerRemoteAppointments/);
    expect(tab).toMatch(/formatTaipeiAppointmentDisplay/);
    expect(tab).toMatch(/尚無預約紀錄/);
    expect(tab).toMatch(/無法讀取預約紀錄/);
    expect(profile).not.toMatch(/AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|createAppointmentRecord/);
    expect(tab).not.toMatch(/\.from\(\s*["']appointments["']\s*\)/);
    expect(tab).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("does not leave temporary appointment or customer-profile diagnostic routes", () => {
    expect(existsSync(path.join(ROOT, "app/staff/(app)/appointment-read-diagnostic/page.tsx"))).toBe(
      false,
    );
    expect(existsSync(path.join(ROOT, "features/appointments/AppointmentReadDiagnosticPage.tsx"))).toBe(
      false,
    );
    expect(existsSync(path.join(ROOT, "lib/appointments/appointment-read-diagnostic.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/appointments/appointment-read-diagnostic-flag.ts"))).toBe(
      false,
    );
    expect(
      existsSync(path.join(ROOT, "app/staff/(app)/customer-profile-isolation/page.tsx")),
    ).toBe(false);
    expect(existsSync(path.join(ROOT, "features/customers/CustomerProfileIsolationPage.tsx"))).toBe(
      false,
    );
    const files = ["app", "lib", "features", "components"].flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".isolation.test.ts")) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (
        source.includes("/staff/appointment-read-diagnostic") ||
        source.includes("/staff/customer-profile-isolation") ||
        source.includes("AppointmentReadDiagnosticPage") ||
        source.includes("CustomerProfileIsolationPage") ||
        source.includes("isAppointmentReadDiagnosticEnabled")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
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

describe("Phase 1C-5D calendar remote read UI boundary", () => {
  it("cuts Calendar remote appointment read only at CalendarPage", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/calendar/page.tsx"), "utf8");
    const calendar = readFileSync(path.join(ROOT, "features/calendar/CalendarPage.tsx"), "utf8");
    const flag = readFileSync(
      path.join(ROOT, "lib/appointments/calendar-remote-read-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/isCalendarRemoteReadPilotEnabled/);
    expect(page).toMatch(/calendar-remote-read-flag/);
    expect(page).not.toMatch(/calendar-remote-read-pilot/);
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(calendar).toMatch(/useCalendarRemoteAppointments/);
    expect(calendar).toMatch(/無法讀取預約資料|CalendarRemoteReadErrorFallback/);
    expect(calendar).not.toMatch(/AppointmentRemoteAdapter|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/);
  });

  it("keeps Today and other live surfaces off the Calendar remote read path", () => {
    const surfaces = [
      "features/today/TodayDashboard.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/customers/use-customer-360.ts",
    ];
    for (const file of surfaces) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /useCalendarRemoteAppointments|listRemoteCalendarAppointmentsByLocationAndRange|BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT/,
      );
    }
  });

  it("keeps Customer 360 appointment remote read independent", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/customers/[id]/page.tsx"), "utf8");
    const tab = readFileSync(path.join(ROOT, "features/customers/tabs/AppointmentsTab.tsx"), "utf8");
    expect(page).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(page).not.toMatch(/isCalendarRemoteReadPilotEnabled|calendar-remote-read/);
    expect(tab).toMatch(/useCustomerRemoteAppointments/);
    expect(tab).not.toMatch(/useCalendarRemoteAppointments/);
  });

  it("does not leave temporary Calendar diagnostic or QA-only routes", () => {
    expect(existsSync(path.join(ROOT, "app/staff/(app)/calendar-read-diagnostic/page.tsx"))).toBe(
      false,
    );
    expect(existsSync(path.join(ROOT, "app/staff/calendar-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "features/calendar/CalendarReadDiagnosticPage.tsx"))).toBe(
      false,
    );
    expect(existsSync(path.join(ROOT, "lib/appointments/calendar-read-diagnostic.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/appointments/calendar-read-diagnostic-flag.ts"))).toBe(
      false,
    );
    const files = ["app", "lib", "features", "components"].flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".isolation.test.ts")) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (
        source.includes("/staff/calendar-read-diagnostic") ||
        source.includes("/staff/calendar-bootstrap") ||
        source.includes("CalendarReadDiagnosticPage") ||
        source.includes("isCalendarReadDiagnosticEnabled")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 1C-5E Today remote read UI boundary", () => {
  it("cuts Today remote appointment read only at TodayDashboard", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/today/page.tsx"), "utf8");
    const today = readFileSync(path.join(ROOT, "features/today/TodayDashboard.tsx"), "utf8");
    const flag = readFileSync(
      path.join(ROOT, "lib/appointments/today-remote-read-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/isTodayRemoteReadPilotEnabled/);
    expect(page).toMatch(/today-remote-read-flag/);
    expect(page).not.toMatch(/today-remote-read-pilot/);
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(today).toMatch(/useTodayRemoteAppointments/);
    expect(today).toMatch(/無法讀取今日預約資料|TodayRemoteReadErrorFallback/);
    expect(today).toMatch(/listTodayAppointments/);
    expect(today).not.toMatch(/AppointmentRemoteAdapter|createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(today).not.toMatch(/useCalendarRemoteAppointments|BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT/);
    expect(today).not.toMatch(/useCustomerRemoteAppointments|BEAUTY_OS_APPOINTMENT_REMOTE_READ_PILOT/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/);
  });

  it("keeps Calendar and Customer 360 off the Today remote read path", () => {
    const surfaces = [
      "features/calendar/CalendarPage.tsx",
      "features/calendar/AppointmentQuickView.tsx",
      "features/customers/tabs/AppointmentsTab.tsx",
      "features/customers/CustomerProfilePage.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/treatments/TreatmentsListPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
      "features/packages/PackagesPageClient.tsx",
      "features/transactions/TransactionsPageClient.tsx",
      "features/customers/use-customer-360.ts",
    ];
    for (const file of surfaces) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /useTodayRemoteAppointments|listRemoteTodayAppointmentsByLocation|BEAUTY_OS_TODAY_REMOTE_READ_PILOT/,
      );
    }
  });

  it("keeps Calendar and Customer 360 remote pilots independent", () => {
    const calendarPage = readFileSync(path.join(ROOT, "app/staff/(app)/calendar/page.tsx"), "utf8");
    const customerPage = readFileSync(
      path.join(ROOT, "app/staff/(app)/customers/[id]/page.tsx"),
      "utf8",
    );
    const tab = readFileSync(path.join(ROOT, "features/customers/tabs/AppointmentsTab.tsx"), "utf8");
    expect(calendarPage).toMatch(/isCalendarRemoteReadPilotEnabled/);
    expect(calendarPage).not.toMatch(/isTodayRemoteReadPilotEnabled|today-remote-read/);
    expect(customerPage).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(customerPage).not.toMatch(/isTodayRemoteReadPilotEnabled|today-remote-read/);
    expect(tab).toMatch(/useCustomerRemoteAppointments/);
    expect(tab).not.toMatch(/useTodayRemoteAppointments/);
  });

  it("does not leave temporary Today diagnostic or bootstrap routes", () => {
    expect(existsSync(path.join(ROOT, "app/staff/(app)/today-read-diagnostic/page.tsx"))).toBe(
      false,
    );
    expect(existsSync(path.join(ROOT, "app/staff/today-bootstrap/page.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "features/today/TodayReadDiagnosticPage.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/appointments/today-read-diagnostic.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "lib/appointments/today-read-diagnostic-flag.ts"))).toBe(
      false,
    );
    const files = ["app", "lib", "features", "components"].flatMap(walkSource);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".isolation.test.ts")) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      if (
        source.includes("/staff/today-read-diagnostic") ||
        source.includes("/staff/today-bootstrap") ||
        source.includes("/staff/today-qa") ||
        source.includes("TodayReadDiagnosticPage") ||
        source.includes("TodayQaPage") ||
        source.includes("isTodayReadDiagnosticEnabled") ||
        source.includes("forceTodayDate") ||
        source.includes("QA_TODAY_DATE")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 1C-6B.1 appointment remote write UI boundary", () => {
  it("keeps Calendar RSC on the read flag and does not import the write graph", () => {
    const page = readFileSync(path.join(ROOT, "app/staff/(app)/calendar/page.tsx"), "utf8");
    const calendar = readFileSync(path.join(ROOT, "features/calendar/CalendarPage.tsx"), "utf8");
    const flag = readFileSync(
      path.join(ROOT, "lib/appointments/appointment-remote-write-flag.ts"),
      "utf8",
    );
    expect(page).toMatch(/isCalendarRemoteReadPilotEnabled|isAppointmentRemoteWritePilotEnabled|isAppointmentRemoteMutatePilotEnabled/);
    expect(page).not.toMatch(/appointment-remote-write-pilot|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter/);
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(calendar).not.toMatch(
      /createAuthenticatedAppointmentWritePersistence|AuthenticatedAppointmentTableStore|AppointmentRemoteAdapter/,
    );
    expect(flag).not.toMatch(
      /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/,
    );
    const mutateFlag = readFileSync(
      path.join(ROOT, "lib/appointments/appointment-remote-mutate-flag.ts"),
      "utf8",
    );
    expect(mutateFlag).not.toMatch(
      /AppointmentRemoteAdapter|AuthenticatedAppointmentTableStore|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/,
    );
    expect(page).not.toMatch(/appointment-remote-mutate-pilot|runAuthenticatedAppointmentWriteMutate/);
    expect(calendar).not.toMatch(
      /appointment-remote-mutate-pilot|runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT/,
    );
  });

  it("does not leave Treatment or Checkout on the write-pilot path", () => {
    for (const file of [
      "features/treatments/TreatmentWorkspace.tsx",
      "features/treatments/TreatmentPageClient.tsx",
      "features/checkout/CheckoutPageClient.tsx",
    ]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(
        /createAuthenticatedAppointmentWritePersistence|runAuthenticatedAppointmentWriteCreate|BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT|runAuthenticatedAppointmentWriteMutate|BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT/,
      );
    }
  });
});

describe("Phase 1C-6H.1 commerce remote identity UI boundary", () => {
  it("cuts Commerce remote read only at Checkout / Today / Complete", () => {
    const checkoutPage = readFileSync(path.join(ROOT, "app/staff/(app)/checkout/page.tsx"), "utf8");
    const todayPage = readFileSync(path.join(ROOT, "app/staff/(app)/today/page.tsx"), "utf8");
    const flag = readFileSync(path.join(ROOT, "lib/commerce/commerce-remote-read-flag.ts"), "utf8");
    expect(checkoutPage).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(checkoutPage).toMatch(/commerce-remote-read-flag/);
    expect(checkoutPage).not.toMatch(/commerce-remote-read-pilot/);
    expect(checkoutPage).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(todayPage).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(todayPage).not.toMatch(/commerce-remote-read-pilot/);
    expect(flag).not.toMatch(/AppointmentRemoteAdapter|TreatmentRemoteAdapter|IdentitySupabaseClient/);
    const checkout = readFileSync(path.join(ROOT, "features/checkout/CheckoutPageClient.tsx"), "utf8");
    expect(checkout).toMatch(/useCommerceRemoteCheckoutCandidates/);
    expect(checkout).toMatch(/CommerceIdentityPanel/);
    expect(checkout).not.toMatch(/completeCheckout|createServiceRoleClient/);
  });

  it("does not enable the Commerce read pilot in Production or Development env files", () => {
    for (const file of [".env", ".env.local", ".env.development", "vercel.json"]) {
      if (!existsSync(path.join(ROOT, file))) continue;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_READ_PILOT/);
      expect(source).not.toMatch(/BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT/);
    }
  });
});

describe("Phase 1C-6H.2 commerce remote write UI boundary", () => {
  it("keeps RSC pages on flag files and CheckoutPanel as the remote settle surface", () => {
    const checkoutPage = readFileSync(path.join(ROOT, "app/staff/(app)/checkout/page.tsx"), "utf8");
    const transactionsPage = readFileSync(
      path.join(ROOT, "app/staff/(app)/transactions/page.tsx"),
      "utf8",
    );
    const writeFlag = readFileSync(
      path.join(ROOT, "lib/commerce/commerce-remote-write-flag.ts"),
      "utf8",
    );
    expect(checkoutPage).toMatch(/isCommerceRemoteWritePilotEnabled/);
    expect(checkoutPage).toMatch(/commerce-remote-write-flag/);
    expect(checkoutPage).not.toMatch(/commerce-remote-write-pilot|AuthenticatedCommerceStore/);
    expect(checkoutPage).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(transactionsPage).toMatch(/isCommerceRemoteReadPilotEnabled/);
    expect(transactionsPage).not.toMatch(/commerce-remote-write-pilot|createServiceRoleClient/);
    expect(writeFlag).not.toMatch(
      /AuthenticatedCommerceStore|loadAuthenticatedIdentityCatalog|IdentitySupabaseClient/,
    );
    const checkout = readFileSync(path.join(ROOT, "features/checkout/CheckoutPageClient.tsx"), "utf8");
    const panel = readFileSync(path.join(ROOT, "features/checkout/CheckoutPanel.tsx"), "utf8");
    expect(checkout).toMatch(/CheckoutPanel/);
    expect(checkout).toMatch(/CommerceIdentityPanel/);
    expect(checkout).toMatch(/useCommerceRemoteDraft/);
    expect(checkout).not.toMatch(/completeCheckout|createServiceRoleClient/);
    expect(panel).toMatch(/submitCommerceRemoteSettle/);
    expect(panel).toMatch(/此付款方式目前尚未開放/);
    expect(panel).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });
});
