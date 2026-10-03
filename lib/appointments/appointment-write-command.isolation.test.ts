import { describe, expect, it, vi } from "vitest";
import { combineLocalDateTime } from "@/lib/appointments/domain";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "@/lib/persistence/test-identity-fixture";
import { UnmappedIdentityError } from "@/lib/persistence/identity-errors";
import { prepareAppointmentCreateCommand } from "./appointment-write-command";
import { createAppointmentWriteSnapshotCatalog } from "./appointment-write-snapshots";
import { appointmentWriteRangeFromTaipei } from "./appointment-write-time";

function snapshots() {
  return createAppointmentWriteSnapshotCatalog({
    customers: [{ organizationId: ORG_A, appId: CUST_SHARED, name: "Canonical Customer" }],
    services: [{ organizationId: ORG_A, appId: SVC_SHARED, name: "Canonical Service" }],
    staff: [{ organizationId: ORG_A, appId: STAFF_A, name: "Canonical Staff" }],
  });
}

describe("Phase 1C-6B.1 appointment write command", () => {
  it("maps Taipei 10:00 / 100 minutes to 02:00Z–03:40Z independently of browser-local Date", () => {
    const range = appointmentWriteRangeFromTaipei("2026-10-09", "10:00", 100);
    expect(range.startsAt).toBe("2026-10-09T02:00:00.000Z");
    expect(range.endsAt).toBe("2026-10-09T03:40:00.000Z");
    expect(range.durationMinutes).toBe(100);
    const browserLocal = combineLocalDateTime("2026-10-09", "10:00").toISOString();
    expect(range.startsAt).not.toBe(browserLocal);
  });

  it("fails closed on invalid local input", () => {
    expect(() => appointmentWriteRangeFromTaipei("2026/10/09", "10:00", 100)).toThrow(
      /Invalid Taipei/,
    );
    expect(() => appointmentWriteRangeFromTaipei("2026-10-09", "10:00", 0)).toThrow(
      /duration/,
    );
  });

  it("generates the app id once and ignores UI snapshot names and status", () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const generateId = vi.fn(() => "apt-once01-abcdef");
    const command = prepareAppointmentCreateCommand(
      {
        organizationId: ORG_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        dateYmd: "2026-10-09",
        startHm: "10:00",
        durationMinutes: 100,
        customerName: "Fake UI Customer",
        serviceName: "Fake UI Service",
        staffName: "Fake UI Staff",
        status: "COMPLETED",
      },
      { mapper: remote.mapper, snapshots: snapshots(), generateId },
    );
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(command.appointmentId).toBe("apt-once01-abcdef");
    expect(command.appointmentId).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(command.status).toBe("BOOKED");
    expect(command.customerName).toBe("Canonical Customer");
    expect(command.serviceName).toBe("Canonical Service");
    expect(command.staffName).toBe("Canonical Staff");
    expect(command.staffId).toBe(STAFF_A);
    expect(command.createdBy).toBe(STAFF_A);
    expect(command.startAt).toBe("2026-10-09T02:00:00.000Z");
    expect(command.endAt).toBe("2026-10-09T03:40:00.000Z");
  });

  it("reuses a pre-generated app id and fail-closes unmapped dependencies", () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const generateId = vi.fn(() => "apt-unused-zzzzzz");
    const command = prepareAppointmentCreateCommand(
      {
        organizationId: ORG_A,
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        appointmentId: "apt-reuse1-abcdef",
        dateYmd: "2026-10-09",
        startHm: "10:00",
        durationMinutes: 100,
      },
      { mapper: remote.mapper, snapshots: snapshots(), generateId },
    );
    expect(command.appointmentId).toBe("apt-reuse1-abcdef");
    expect(generateId).toHaveBeenCalledTimes(0);
    expect(() =>
      prepareAppointmentCreateCommand(
        {
          organizationId: ORG_A,
          locationId: "loc-missing",
          customerId: CUST_SHARED,
          serviceId: SVC_SHARED,
          staffId: STAFF_A,
          dateYmd: "2026-10-09",
          startHm: "10:00",
          durationMinutes: 100,
        },
        { mapper: remote.mapper, snapshots: snapshots() },
      ),
    ).toThrow(UnmappedIdentityError);
  });
});
