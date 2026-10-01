import { describe, expect, it, vi } from "vitest";
import { UnmappedIdentityError } from "./identity-errors";
import { AppointmentRemoteAdapter } from "./appointment-remote-adapter";
import { createMemoryRemotePersistence } from "./remote-factory";
import { remoteAppointmentPayload } from "./appointment-mapping";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "./test-identity-fixture";
import type { CreateAppointmentInput } from "@/lib/appointments/store";
import type { AppointmentTableStore, DbAppointment } from "./operational-rows";

const START = "2026-10-01T02:00:00.000Z";
const END = "2026-10-01T03:00:00.000Z";

function input(overrides: Partial<CreateAppointmentInput> = {}): CreateAppointmentInput {
  return {
    locationId: LOC_A1,
    customerId: CUST_SHARED,
    serviceId: SVC_SHARED,
    staffId: STAFF_A,
    startAt: START,
    endAt: END,
    createdBy: STAFF_A,
    ...overrides,
  };
}

describe("Phase 1B canonical appointment remote adapter", () => {
  it("maps apt-* to app_id and org/location/staff snapshots", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await remote.appointments.create(ORG_A, {
      ...input(),
      id: "apt-1001",
      customerName: "真實客人",
      serviceName: "美胸",
      staffName: "怡蓁",
    } as CreateAppointmentInput & { id: string; customerName: string; serviceName: string; staffName: string });
    expect(created.id).toBe("apt-1001");
    const orgDbId = remote.mapper.resolveOrganizationDbId(ORG_A);
    const row = db.getAppointmentByAppId(orgDbId, "apt-1001");
    expect(row?.app_id).toBe("apt-1001");
    expect(row?.organization_id).toBe(orgDbId);
    expect(row?.location_id).toBe(remote.mapper.resolveLocationDbId(ORG_A, LOC_A1));
    expect(row?.staff_id).toBe(STAFF_A);
    expect(row?.created_by).toBe(STAFF_A);
    expect(row?.customer_name_snapshot).toBe("真實客人");
    expect(row?.service_name_snapshot).toBe("美胸");
    expect(row?.staff_name_snapshot).toBe("怡蓁");
    expect(row?.starts_at).toBe(START);
    expect(row?.ends_at).toBe(END);
    expect(row?.status).toBe("BOOKED");
    expect(row?.customer_id).toBe(remote.mapper.resolveCustomerDbId(ORG_A, CUST_SHARED));
    expect(row?.service_id).toBe(remote.mapper.resolveServiceDbId(ORG_A, SVC_SHARED));
  });

  it("accepts staff-001 and rejects Auth UUID before insert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    const { staffA } = seedTwoOrgs(db);
    const insert = vi.fn();
    const spyStore: AppointmentTableStore = {
      insertAppointment: (row) => {
        insert(row);
        db.insertAppointment(row);
      },
      listAppointments: (org) => db.listAppointments(org),
      getAppointmentByAppId: (org, appId) => db.getAppointmentByAppId(org, appId),
      getAppointmentByDbId: (id) => db.getAppointmentByDbId(id),
    };
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore);
    await adapter.create(ORG_A, input({ staffId: STAFF_A, createdBy: STAFF_A }));
    expect(insert).toHaveBeenCalledTimes(1);
    await expect(
      adapter.create(ORG_A, input({ staffId: staffA.authUserId!, createdBy: staffA.authUserId! })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("unmapped customer → no insert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const spyStore: AppointmentTableStore = {
      insertAppointment: (row) => {
        insert(row);
        db.insertAppointment(row);
      },
      listAppointments: (org) => db.listAppointments(org),
      getAppointmentByAppId: (org, appId) => db.getAppointmentByAppId(org, appId),
      getAppointmentByDbId: (id) => db.getAppointmentByDbId(id),
    };
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore);
    await expect(
      adapter.create(ORG_A, input({ customerId: "cust-missing" })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(insert).toHaveBeenCalledTimes(0);
  });

  it("unmapped service → appointment remote write throws and Supabase insert spy = 0", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const supabaseInsert = vi.fn(async () => ({ data: null, error: null }));
    const supabaseFrom = vi.fn((table: string) => {
      expect(table).toBe("appointments");
      return { insert: supabaseInsert };
    });
    const spyStore: AppointmentTableStore = {
      insertAppointment: (row: DbAppointment) => {
        supabaseFrom("appointments").insert(remoteAppointmentPayload(row));
        db.insertAppointment(row);
      },
      listAppointments: (org) => db.listAppointments(org),
      getAppointmentByAppId: (org, appId) => db.getAppointmentByAppId(org, appId),
      getAppointmentByDbId: (id) => db.getAppointmentByDbId(id),
    };
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore);
    await expect(
      adapter.create(ORG_A, input({ serviceId: "svc-missing" })),
    ).rejects.toBeInstanceOf(UnmappedIdentityError);
    expect(supabaseFrom).toHaveBeenCalledTimes(0);
    expect(supabaseInsert).toHaveBeenCalledTimes(0);
  });

  it("rejects end <= start before insert", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const insert = vi.fn();
    const spyStore: AppointmentTableStore = {
      insertAppointment: (row) => {
        insert(row);
        db.insertAppointment(row);
      },
      listAppointments: (org) => db.listAppointments(org),
      getAppointmentByAppId: (org, appId) => db.getAppointmentByAppId(org, appId),
      getAppointmentByDbId: (id) => db.getAppointmentByDbId(id),
    };
    const adapter = new AppointmentRemoteAdapter(remote.mapper, spyStore);
    await expect(
      adapter.create(ORG_A, input({ startAt: END, endAt: START })),
    ).rejects.toThrow(/endAt must be after startAt/);
    await expect(
      adapter.create(ORG_A, input({ startAt: START, endAt: START })),
    ).rejects.toThrow(/endAt must be after startAt/);
    expect(insert).toHaveBeenCalledTimes(0);
  });

  it("maps status and internal_note snapshots without a remote notes array", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const created = await remote.appointments.create(ORG_A, {
      ...input(),
      status: "CONFIRMED",
      internalNote: "內部備註",
      notes: ["ignored-if-internal-present"],
      customerNote: "客人備註",
    } as CreateAppointmentInput & { status: "CONFIRMED"; notes: string[] });
    expect(created.status).toBe("CONFIRMED");
    const row = db.getAppointmentByAppId(
      remote.mapper.resolveOrganizationDbId(ORG_A),
      created.id,
    );
    expect(row?.status).toBe("CONFIRMED");
    expect(row?.internal_note).toBe("內部備註");
    expect(row?.customer_note).toBe("客人備註");
    expect(remoteAppointmentPayload(row!)).not.toHaveProperty("notes");
  });
});
