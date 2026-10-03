import { describe, expect, it, vi } from "vitest";
import { createAppointment, listAppointments } from "@/lib/appointments/store";
import { APPOINTMENT_INSERT_ONLY_MESSAGE } from "@/lib/persistence/authenticated-appointment-store";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  ORG_A,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "@/lib/persistence/test-identity-fixture";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { APPOINTMENT_STAFF_OVERLAP_MESSAGE, createAppointmentRecord } from "./appointment-queries";
import { prepareAppointmentCreateCommand } from "./appointment-write-command";
import {
  AppointmentConflictError,
  AppointmentWriteIntegrityError,
  AppointmentWriteRetryableError,
  createAppointmentSafely,
  isAppointmentExclusionConflictError,
  type AppointmentWriteHost,
} from "./appointment-write-create";
import { createAppointmentWriteSnapshotCatalog } from "./appointment-write-snapshots";
import {
  AppointmentCreateSubmission,
  appointmentWriteSaveDisabled,
} from "./appointment-write-submit";
import type { ScheduleAppointment } from "./domain";

function snapshots() {
  return createAppointmentWriteSnapshotCatalog({
    customers: [{ organizationId: ORG_A, appId: CUST_SHARED, name: "Canonical Customer" }],
    services: [{ organizationId: ORG_A, appId: SVC_SHARED, name: "Canonical Service" }],
    staff: [{ organizationId: ORG_A, appId: STAFF_A, name: "Canonical Staff" }],
  });
}

function command(remote: ReturnType<typeof createMemoryRemotePersistence>["remote"], id: string) {
  return prepareAppointmentCreateCommand(
    {
      organizationId: ORG_A,
      locationId: LOC_A1,
      customerId: CUST_SHARED,
      serviceId: SVC_SHARED,
      staffId: STAFF_A,
      appointmentId: id,
      dateYmd: "2026-10-09",
      startHm: "10:00",
      durationMinutes: 100,
    },
    { mapper: remote.mapper, snapshots: snapshots() },
  );
}

function hostFrom(
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"],
  create: AppointmentWriteHost["appointments"]["create"],
): AppointmentWriteHost {
  return {
    appointments: {
      list: (query) => remote.appointments.list(query),
      get: (org, id) => remote.appointments.get(org, id),
      create,
    },
  };
}

describe("Phase 1C-6B.1 appointment write create / submit", () => {
  it("creates once with a stable app id that is not the DB UUID", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-stable-abcdef");
    const created = await createAppointmentSafely(prepared, remote);
    expect(created.outcome).toBe("created");
    expect(created.appointment.id).toBe("apt-stable-abcdef");
    expect(created.appointment.status).toBe("BOOKED");
    expect(db.appointments).toHaveLength(1);
    expect(db.appointments[0]?.app_id).toBe("apt-stable-abcdef");
    expect(db.appointments[0]?.id).not.toBe("apt-stable-abcdef");
    expect(db.appointments[0]?.staff_id).toBe(STAFF_A);
    expect(db.appointments[0]?.created_by).toBe(STAFF_A);
  });

  it("retries the same app id and recovers an unknown commit via read-back", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-retry1-abcdef");
    let attempts = 0;
    const wrapped = hostFrom(remote, async (org, input) => {
      attempts += 1;
      const created = await remote.appointments.create(org, input);
      if (attempts === 1) throw new Error("timeout");
      return created;
    });
    const first = await createAppointmentSafely(prepared, wrapped);
    expect(first.outcome).toBe("recovered");
    expect(first.appointment.id).toBe("apt-retry1-abcdef");
    expect(db.appointments).toHaveLength(1);

    const insertOnly = hostFrom(remote, async () => {
      throw new Error(APPOINTMENT_INSERT_ONLY_MESSAGE);
    });
    const second = await createAppointmentSafely(prepared, insertOnly);
    expect(second.outcome).toBe("recovered");
    expect(second.appointment.id).toBe("apt-retry1-abcdef");
    expect(db.appointments).toHaveLength(1);
  });

  it("returns retryable failure when read-back finds nothing after timeout", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-miss01-abcdef");
    const wrapped = hostFrom(remote, async () => {
      throw new Error("Failed to fetch");
    });
    await expect(createAppointmentSafely(prepared, wrapped)).rejects.toBeInstanceOf(
      AppointmentWriteRetryableError,
    );
    expect(db.appointments).toHaveLength(0);
  });

  it("hard-errors when the same app id has a mismatched payload", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const first = command(remote, "apt-clash1-abcdef");
    await createAppointmentSafely(first, remote);
    const mismatched: AppointmentWriteHost = {
      appointments: {
        list: async () => [],
        get: async () =>
          ({
            ...(await remote.appointments.get(ORG_A, first.appointmentId))!,
            customerId: "cust-other-zzzzzz",
          }) as ScheduleAppointment,
        create: async () => {
          throw new Error(APPOINTMENT_INSERT_ONLY_MESSAGE);
        },
      },
    };
    await expect(createAppointmentSafely(first, mismatched)).rejects.toBeInstanceOf(
      AppointmentWriteIntegrityError,
    );
  });

  it("does not upsert a second overlapping staff booking", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    await createAppointmentSafely(command(remote, "apt-first1-abcdef"), remote);
    await expect(
      createAppointmentSafely(command(remote, "apt-second-abcdef"), remote),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
    expect(db.appointments).toHaveLength(1);
  });

  it("double-click issues one create request and success cannot submit again", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-click1-abcdef");
    const submission = new AppointmentCreateSubmission(prepared.appointmentId);
    const run = vi.fn(async (appointmentId: string) => {
      expect(appointmentId).toBe(prepared.appointmentId);
      return createAppointmentSafely(prepared, remote);
    });
    const first = submission.submit(run);
    const second = submission.submit(run);
    expect(await second).toBe("ignored");
    expect(await first).toBe("success");
    expect(run).toHaveBeenCalledTimes(1);
    expect(submission.createRequests).toBe(1);
    expect(appointmentWriteSaveDisabled(submission.phase)).toBe(true);
    await expect(submission.submit(run)).rejects.toThrow(/already succeeded/);
    expect(db.appointments).toHaveLength(1);
  });

  it("retry after definite failure reuses the same app id", async () => {
    const { db, remote: persistence } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(persistence, "apt-fail01-abcdef");
    const submission = new AppointmentCreateSubmission(prepared.appointmentId);
    let shouldFail = true;
    const run = vi.fn(async (appointmentId: string) => {
      expect(appointmentId).toBe("apt-fail01-abcdef");
      if (shouldFail) {
        shouldFail = false;
        throw new Error("validation failed");
      }
      return createAppointmentSafely(prepared, persistence);
    });
    expect(await submission.submit(run)).toBe("error");
    expect(submission.phase).toBe("error");
    expect(await submission.submit(run)).toBe("success");
    expect(run).toHaveBeenCalledTimes(2);
    expect(db.appointments[0]?.app_id).toBe("apt-fail01-abcdef");
  });

  it("remote error does not write a local appointment", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-noloc1-abcdef");
    const wrapped = hostFrom(remote, async () => {
      throw new Error("insert appointment: permission denied");
    });
    await expect(createAppointmentSafely(prepared, wrapped)).rejects.toThrow(/permission denied/);
    expect(db.appointments).toHaveLength(0);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID }).some(
        (row) => row.id === "apt-noloc1-abcdef",
      ),
    ).toBe(false);
    expect(createAppointment).not.toBe(createAppointmentSafely);
  });

  it("maps a PostgREST exclusion violation to AppointmentConflictError without retry", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-excl01-abcdef");
    const wrapped = hostFrom(remote, async () => {
      throw new Error(
        'insert appointment: conflicting key value violates exclusion constraint "appointments_staff_active_no_overlap"',
      );
    });
    await expect(createAppointmentSafely(prepared, wrapped)).rejects.toMatchObject({
      name: "AppointmentConflictError",
      sqlstate: "23P01",
      message: APPOINTMENT_STAFF_OVERLAP_MESSAGE,
    });
    expect(db.appointments).toHaveLength(0);
  });

  it("maps SQLSTATE 23P01 to AppointmentConflictError and keeps the same app id", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-23p01-abcdef");
    const submission = new AppointmentCreateSubmission(prepared.appointmentId);
    const failing = hostFrom(remote, async () => {
      throw new Error("23P01 exclusion_violation");
    });
    expect(
      await submission.submit(async (appointmentId) => {
        expect(appointmentId).toBe("apt-23p01-abcdef");
        return createAppointmentSafely(prepared, failing);
      }),
    ).toBe("error");
    expect(submission.error).toBeInstanceOf(AppointmentConflictError);
    expect(isAppointmentExclusionConflictError(submission.error)).toBe(true);
    expect(submission.appointmentId).toBe("apt-23p01-abcdef");
    expect(db.appointments).toHaveLength(0);
    expect(
      await submission.submit(async (appointmentId) => {
        expect(appointmentId).toBe("apt-23p01-abcdef");
        return createAppointmentSafely(prepared, remote);
      }),
    ).toBe("success");
    expect(db.appointments).toHaveLength(1);
    expect(db.appointments[0]?.app_id).toBe("apt-23p01-abcdef");
  });

  it("does not treat unique-constraint 23505 as an exclusion conflict", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const prepared = command(remote, "apt-uniq01-abcdef");
    await createAppointmentSafely(prepared, remote);
    const uniqueOnly = hostFrom(remote, async () => {
      throw new Error(
        'insert appointment: duplicate key value violates unique constraint "idx_appointments_org_app_id" (23505)',
      );
    });
    expect(isAppointmentExclusionConflictError(new Error("23505 unique constraint"))).toBe(false);
    const recovered = await createAppointmentSafely(prepared, uniqueOnly);
    expect(recovered.outcome).toBe("recovered");
    expect(recovered.appointment.id).toBe("apt-uniq01-abcdef");
    expect(db.appointments).toHaveLength(1);
  });

  it("createAppointmentRecord generates the app id before create", async () => {
    const { db, remote } = createMemoryRemotePersistence();
    seedTwoOrgs(db);
    const generateId = vi.fn(() => "apt-bound1-abcdef");
    const created = await createAppointmentRecord(
      ORG_A,
      {
        locationId: LOC_A1,
        customerId: CUST_SHARED,
        serviceId: SVC_SHARED,
        staffId: STAFF_A,
        startAt: "2026-10-09T02:00:00.000Z",
        endAt: "2026-10-09T03:40:00.000Z",
        createdBy: STAFF_A,
      },
      remote,
      generateId,
    );
    expect(generateId).toHaveBeenCalledTimes(1);
    expect(created.id).toBe("apt-bound1-abcdef");
    expect(db.appointments[0]?.app_id).toBe("apt-bound1-abcdef");
  });
});
