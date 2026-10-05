import { readFileSync } from "node:fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { COMMERCE_REMOTE_READ_PILOT_ENV } from "@/lib/commerce/commerce-remote-read-flag";
import { COMMERCE_REMOTE_WRITE_PILOT_ENV } from "@/lib/commerce/commerce-remote-write-flag";
import { CUSTOMER_REMOTE_READ_PILOT_ENV } from "@/lib/customers/customer-remote-read-flag";
import { CUSTOMER_REMOTE_WRITE_PILOT_ENV } from "@/lib/customers/customer-remote-write-flag";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const CUSTOMER_NAV_SOURCES = [
  "features/checkout/CheckoutPanel.tsx",
  "features/calendar/AppointmentQuickView.tsx",
  "components/appointments/AppointmentCard.tsx",
  "components/appointments/NextCustomerPanel.tsx",
  "features/treatments/TreatmentDetailReadonly.tsx",
  "features/treatments/TreatmentQuickView.tsx",
  "features/transactions/TransactionQuickView.tsx",
  "features/customers/CustomerQuickView.tsx",
] as const;

describe("Phase 1C-6H.2A Customer 360 remote identity", () => {
  it("reads Customer remote flags at request time on list / 360 / edit RSC", () => {
    for (const file of [
      "app/staff/(app)/customers/page.tsx",
      "app/staff/(app)/customers/[id]/page.tsx",
      "app/staff/(app)/customers/[id]/edit/page.tsx",
    ]) {
      const source = read(file);
      expect(source).toMatch(/await connection\(\)/);
      expect(source).toMatch(/isCustomerRemoteReadPilotEnabled/);
      expect(source).not.toMatch(
        /customer-remote-read-pilot|createAuthenticatedCustomerReadPersistence/,
      );
      expect(source).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("keeps Customer 360 and edit off local fallback when remote read is on", () => {
    const profile = read("features/customers/CustomerProfilePage.tsx");
    const edit = read("features/customers/CustomerEditForm.tsx");
    expect(profile).toMatch(/useCustomerRemoteDetail/);
    expect(profile).toMatch(/remoteReadPilot[\s\S]*\? null/);
    expect(profile).not.toMatch(/localCustomers[\s\S]*remote\.status === "empty"/);
    expect(edit).toMatch(/useCustomerRemoteDetail/);
    expect(edit).toMatch(/remoteReadPilot[\s\S]*\? null/);
    expect(edit).not.toMatch(/Access unavailable/);
    expect(edit).toMatch(/目前無法編輯/);
  });

  it("navigates Customer 360 with the same canonical customer id on every surface", () => {
    for (const file of CUSTOMER_NAV_SOURCES) {
      const source = read(file);
      expect(source).toMatch(
        /\/staff\/customers\/\$\{(?:item|appointment|customer|row|model)\.(?:customerId|id)\}/,
      );
    }
    const checkout = read("features/checkout/CheckoutPanel.tsx");
    expect(checkout).toMatch(/\/staff\/customers\/\$\{item\.customerId\}/);
    expect(checkout).not.toMatch(/\/staff\/customers\/\$\{.*appointmentId/);
    expect(checkout).not.toMatch(/\/staff\/customers\/\$\{.*treatmentId/);
    const treatment = read("features/treatments/TreatmentDetailReadonly.tsx");
    expect(treatment).toMatch(/\/staff\/customers\/\$\{customer\.id\}/);
    const tx = read("features/transactions/TransactionQuickView.tsx");
    expect(tx).toMatch(/\/staff\/customers\/\$\{model\.customerId\}/);
  });

  it("does not send appointment / treatment / checkout / auth ids to Customer 360", () => {
    for (const file of CUSTOMER_NAV_SOURCES) {
      const source = read(file);
      expect(source).not.toMatch(/\/staff\/customers\/\$\{[^}]*appointmentId/);
      expect(source).not.toMatch(/\/staff\/customers\/\$\{[^}]*treatmentId/);
      expect(source).not.toMatch(/\/staff\/customers\/\$\{[^}]*draftId/);
      expect(source).not.toMatch(/\/staff\/customers\/\$\{[^}]*authUserId/);
    }
  });

  it("leaves Commerce READ / WRITE flag names unchanged", () => {
    expect(COMMERCE_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_COMMERCE_REMOTE_READ_PILOT");
    expect(COMMERCE_REMOTE_WRITE_PILOT_ENV).toBe("BEAUTY_OS_COMMERCE_REMOTE_WRITE_PILOT");
    expect(CUSTOMER_REMOTE_READ_PILOT_ENV).toBe("BEAUTY_OS_CUSTOMER_REMOTE_READ_PILOT");
    expect(CUSTOMER_REMOTE_WRITE_PILOT_ENV).toBe("BEAUTY_OS_CUSTOMER_REMOTE_WRITE_PILOT");
    const writeFlag = read("lib/commerce/commerce-remote-write-flag.ts");
    expect(writeFlag).toMatch(/Independent of BEAUTY_OS_PERSISTENCE/);
    expect(writeFlag).not.toMatch(/env\[.BEAUTY_OS_PERSISTENCE/);
  });
});
