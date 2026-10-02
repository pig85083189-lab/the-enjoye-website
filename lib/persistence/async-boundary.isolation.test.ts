import { describe, expect, it } from "vitest";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { listAppointments } from "@/lib/appointments/store";
import { localOperationalPersistence } from "./local-adapter";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

describe("Phase 1B async compatibility", () => {
  it("keeps live customer repository and appointment store synchronous", () => {
    const customers = localCustomerRepository.list({ organizationId: ORG_ENJOYE_ID });
    expect(Array.isArray(customers)).toBe(true);
    expect(customers).not.toBeInstanceOf(Promise);
    const appointments = listAppointments({ organizationId: ORG_ENJOYE_ID });
    expect(Array.isArray(appointments)).toBe(true);
    expect(appointments).not.toBeInstanceOf(Promise);
  });

  it("exposes async CustomerPersistence without faking a sync remote adapter", () => {
    const pending = localOperationalPersistence.customers.list({
      organizationId: ORG_ENJOYE_ID,
    });
    expect(pending).toBeInstanceOf(Promise);
    expect(localOperationalPersistence.appointments.list).toBe(listAppointments);
  });
});
