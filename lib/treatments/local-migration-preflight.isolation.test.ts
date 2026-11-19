import { describe, expect, it } from "vitest";
import { LEGACY_STORAGE_KEYS } from "@/lib/tenant/constants";
import {
  preflightLocalMigration,
  readLocalMigrationBackup,
  taipeiServiceDate,
  type LocalStorageView,
  type RemoteIdentitySnapshot,
} from "./local-migration-preflight";

const ORG = "org-the-enjoye";
const SCHEDULE = `beauty-os:${ORG}:schedule-appointments:v1`;
const COMPLETED = `beauty-os:${ORG}:treatments-completed:v1`;
const START = "2026-11-19T02:00:00.000Z";

function storage(entries: Record<string, unknown>): LocalStorageView {
  const encoded = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    keys: () => Object.keys(encoded),
    getItem: (key) => encoded[key] ?? null,
  };
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "apt-nov19-abcdef",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-line-1",
    staffId: "staff-001",
    serviceId: "svc-upup",
    serviceName: "美液澎潤upupSPA",
    staffName: "測試帳號",
    startAt: START,
    endAt: "2026-11-19T03:00:00.000Z",
    status: "BOOKED",
    guestContactPhone: "0900000000",
    ...overrides,
  };
}

function treatment(overrides: Record<string, unknown> = {}) {
  return {
    id: "treatment-apt-nov19-abcdef",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    appointmentId: "apt-nov19-abcdef",
    customerId: "cust-line-1",
    staffId: "staff-001",
    serviceId: "svc-upup",
    status: "completed",
    assessment: { concerns: ["乾燥"], consultationAnswers: { "next-course": ["美液澎潤upupSPA"] } },
    bodyMarkers: [{ id: "marker-1", area: "肩頸", conditions: ["緊繃"], note: "右側" }],
    bodyMapNote: "右肩補充說明",
    professionalNote: "本次以保濕為主",
    clientFeeling: "舒服",
    followUp: { note: "兩週後回診", suggestedDate: "2026-12-19" },
    ...overrides,
  };
}

const confirmedRemote: RemoteIdentitySnapshot = {
  customers: [{ appId: "cust-line-1", dbId: "customer-db-1", status: "ACTIVE" }],
  appointments: [{ appId: "apt-nov19-abcdef", customerDbId: "customer-db-1", startsAt: START }],
  lineLinks: [{ customerDbId: "customer-db-1", revokedAt: null }],
};

describe("local migration backup", () => {
  it("copies appointment and completed treatment ids without phone or other storage", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
      [`beauty-os:${ORG}:checkout-drafts:v1`]: [{ secret: "do-not-copy" }],
    }));
    expect(backup.readOnly).toBe(true);
    expect(backup.appointments).toHaveLength(1);
    expect(backup.completedTreatments).toHaveLength(1);
    expect(backup.appointments[0]).toMatchObject({
      id: "apt-nov19-abcdef",
      customerId: "cust-line-1",
      organizationId: ORG,
      locationId: "loc-enjoye-main",
      staffId: "staff-001",
      serviceId: "svc-upup",
    });
    expect(JSON.stringify(backup)).not.toContain("0900000000");
    expect(JSON.stringify(backup)).not.toContain("do-not-copy");
    expect(taipeiServiceDate(backup.appointments[0]!.startAt)).toBe("2026-11-19");
  });

  it("keeps a legacy completed record when another key cannot be parsed", () => {
    const encoded: Record<string, string> = {
      [LEGACY_STORAGE_KEYS.treatmentsCompleted]: JSON.stringify([treatment()]),
      [SCHEDULE]: "{not-json",
    };
    const backup = readLocalMigrationBackup({
      keys: () => Object.keys(encoded),
      getItem: (key) => encoded[key] ?? null,
    });
    expect(backup.unreadableKeys).toEqual([SCHEDULE]);
    expect(backup.completedTreatments).toHaveLength(1);
    expect(backup.appointments).toHaveLength(0);
  });
});

describe("local migration preflight", () => {
  it("does not call a browser record transferable before a read-only finance snapshot exists", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
    }));
    const report = preflightLocalMigration(backup);
    expect(report.transferableAppointmentIds).toEqual([]);
    expect(report.rows[0]).toMatchObject({
      serviceDate: "2026-11-19",
      customerMatch: "not-provided",
      lineLink: "not-provided",
      financeAppointment: "not-provided",
      transferable: false,
      clinical: { assessment: true, body: true, professional: true, followUp: true },
    });
  });

  it("does not confirm a customer from a different id", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
    }));
    const report = preflightLocalMigration(backup, {
      customers: [{ appId: "cust-other", dbId: "customer-db-other", status: "ACTIVE" }],
      appointments: [],
      lineLinks: [{ customerDbId: "customer-db-other", revokedAt: null }],
    });
    expect(report.rows[0]?.customerMatch).toBe("unconfirmed");
    expect(report.rows[0]?.financeAppointment).toBe("absent");
    expect(report.rows[0]?.transferable).toBe(false);
    expect(report.rows[0]?.reason).toContain("不能移轉");
  });

  it("stops when the finance appointment does not exist", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
    }));
    const report = preflightLocalMigration(backup, {
      ...confirmedRemote,
      appointments: [],
    });
    expect(report.rows[0]?.customerMatch).toBe("confirmed");
    expect(report.rows[0]?.lineLink).toBe("active");
    expect(report.rows[0]?.financeAppointment).toBe("absent");
    expect(report.rows[0]?.transferable).toBe(false);
    expect(report.rows[0]?.reason).toContain("不建立預約");
  });

  it("stops when the only LINE link is revoked", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
    }));
    const report = preflightLocalMigration(backup, {
      ...confirmedRemote,
      lineLinks: [{ customerDbId: "customer-db-1", revokedAt: "2026-11-01T00:00:00.000Z" }],
    });
    expect(report.rows[0]?.lineLink).toBe("revoked-only");
    expect(report.rows[0]?.transferable).toBe(false);
  });

  it("allows a later transfer only when the appointment customer and active LINE link match", () => {
    const backup = readLocalMigrationBackup(storage({
      [SCHEDULE]: [appointment()],
      [COMPLETED]: [treatment()],
    }));
    const report = preflightLocalMigration(backup, confirmedRemote);
    expect(report.transferableAppointmentIds).toEqual(["apt-nov19-abcdef"]);
    expect(report.rows[0]?.transferable).toBe(true);
  });
});
