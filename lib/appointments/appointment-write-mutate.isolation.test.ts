import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAppointment, listAppointments, updateAppointment } from "@/lib/appointments/store";
import { createMemoryRemotePersistence } from "@/lib/persistence/remote-factory";
import {
  CUST_SHARED,
  LOC_A1,
  LOC_A2,
  LOC_B1,
  ORG_A,
  ORG_B,
  STAFF_A,
  SVC_SHARED,
  seedTwoOrgs,
} from "@/lib/persistence/test-identity-fixture";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { assertTransition } from "./domain";
import { prepareAppointmentCreateCommand } from "./appointment-write-command";
import { createAppointmentSafely } from "./appointment-write-create";
import { createAppointmentWriteSnapshotCatalog } from "./appointment-write-snapshots";
import { prepareAppointmentMutateCommand } from "./appointment-write-mutate-command";
import {
  AppointmentConflictError,
  AppointmentWriteNotFoundError,
  AppointmentWriteRetryableError,
  AppointmentWriteStaleError,
  AppointmentWriteZeroRowError,
  appointmentMatchesPreparedMutate,
  mutateAppointmentSafely,
  type AppointmentMutateHost,
} from "./appointment-write-mutate";
import { AppointmentCustomerImmutableError } from "./appointment-write-mutate-errors";
import type { ScheduleAppointment } from "./domain";

function snapshots() {
  return createAppointmentWriteSnapshotCatalog({
    customers: [{ organizationId: ORG_A, appId: CUST_SHARED, name: "Canonical Customer" }],
    services: [{ organizationId: ORG_A, appId: SVC_SHARED, name: "Canonical Service" }],
    staff: [{ organizationId: ORG_A, appId: STAFF_A, name: "Canonical Staff" }],
  });
}

async function seedCreated(
  id = "apt-mut01-abcdef",
): Promise<{
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"];
  db: ReturnType<typeof createMemoryRemotePersistence>["db"];
  current: ScheduleAppointment;
}> {
  const { db, remote } = createMemoryRemotePersistence();
  seedTwoOrgs(db);
  const created = await createAppointmentSafely(
    prepareAppointmentCreateCommand(
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
    ),
    remote,
  );
  return { remote, db, current: created.appointment };
}

function commandFor(
  remote: ReturnType<typeof createMemoryRemotePersistence>["remote"],
  current: ScheduleAppointment,
  input: Parameters<typeof prepareAppointmentMutateCommand>[0],
) {
  return prepareAppointmentMutateCommand(input, current, {
    mapper: remote.mapper,
    snapshots: snapshots(),
    organizationId: ORG_A,
    updatedBy: STAFF_A,
    now: () => "2026-10-03T00:00:00.000Z",
  });
}

describe("Phase 1C-6D.1 appointment mutate commands and optimistic update", () => {
  it("requires expectedUpdatedAt and refuses allowConflict / customer reassignment", async () => {
    const { remote, current } = await seedCreated();
    expect(() =>
      commandFor(remote, current, {
        kind: "cancel",
        appointmentId: current.id,
        expectedUpdatedAt: "",
      }),
    ).toThrow(/expectedUpdatedAt/);
    expect(() =>
      commandFor(remote, current, {
        kind: "cancel",
        appointmentId: current.id,
        expectedUpdatedAt: current.updatedAt,
        allowConflict: true,
      }),
    ).toThrow(/allowConflict/);
    expect(() =>
      commandFor(remote, current, {
        kind: "cancel",
        appointmentId: current.id,
        expectedUpdatedAt: current.updatedAt,
        customerId: "cust-other-zzzzzz",
      }),
    ).toThrow(AppointmentCustomerImmutableError);
    expect(() =>
      commandFor(remote, current, {
        kind: "transition",
        appointmentId: current.id,
        expectedUpdatedAt: current.updatedAt,
        status: "COMPLETED",
      }),
    ).toThrow(/Invalid appointment transition/);
    expect(() => assertTransition("BOOKED", "CANCELLED")).not.toThrow();
  });

  it("prepares cancel / reschedule / transition with derived duration and snapshots", async () => {
    const { remote, current } = await seedCreated();
    const cancel = commandFor(remote, current, {
      kind: "cancel",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      status: "NO_SHOW",
      statusReason: "客人未到",
    });
    expect(cancel.status).toBe("NO_SHOW");
    expect(cancel.cancelledAt).toBe("2026-10-03T00:00:00.000Z");
    expect(cancel.cancelledBy).toBe(STAFF_A);
    expect(cancel.customerId).toBe(CUST_SHARED);
    expect(cancel.durationMinutes).toBe(100);

    const reschedule = commandFor(remote, current, {
      kind: "reschedule",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      dateYmd: "2026-10-09",
      startHm: "14:00",
      durationMinutes: 60,
      locationId: LOC_A2,
    });
    expect(reschedule.startAt).toBe("2026-10-09T06:00:00.000Z");
    expect(reschedule.endAt).toBe("2026-10-09T07:00:00.000Z");
    expect(reschedule.durationMinutes).toBe(60);
    expect(reschedule.locationId).toBe(LOC_A2);
    expect(reschedule.locationChanged).toBe(true);
    expect(reschedule.customerName).toBe("Canonical Customer");
    expect(reschedule.serviceName).toBe("Canonical Service");
    expect(reschedule.staffName).toBe("Canonical Staff");
    expect(reschedule.status).toBe("BOOKED");

    const transition = commandFor(remote, current, {
      kind: "transition",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      status: "CONFIRMED",
    });
    expect(transition.status).toBe("CONFIRMED");
    expect(transition.cancelledAt).toBeUndefined();
  });

  it("updates through verified app_id → DB UUID and ignores a redirect UUID", async () => {
    const { remote, db, current } = await seedCreated();
    const orgDbId = remote.mapper.resolveOrganizationDbId(ORG_A);
    const row = db.getAppointmentByAppId(orgDbId, current.id)!;
    const otherId = "99999999-9999-4999-8999-999999999999";
    const prepared = commandFor(remote, current, {
      kind: "transition",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      status: "CONFIRMED",
      dbId: otherId,
    });
    await expect(mutateAppointmentSafely(prepared, remote)).rejects.toBeInstanceOf(
      AppointmentWriteNotFoundError,
    );
    expect(db.getAppointmentByAppId(orgDbId, current.id)?.status).toBe("BOOKED");
    expect(db.getAppointmentByDbId(otherId)).toBeUndefined();

    const ok = commandFor(remote, current, {
      kind: "transition",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      status: "CONFIRMED",
      dbId: row.id,
    });
    const updated = await mutateAppointmentSafely(ok, remote);
    expect(updated.outcome).toBe("updated");
    expect(updated.appointment.status).toBe("CONFIRMED");
    expect(updated.appointment.id).toBe(current.id);
    expect(updated.appointment.customerId).toBe(CUST_SHARED);
    expect(db.getAppointmentByAppId(orgDbId, current.id)?.id).toBe(row.id);
    expect(db.getAppointmentByAppId(orgDbId, current.id)?.updated_at).not.toBe(row.updated_at);
  });

  it("returns stale when expectedUpdatedAt does not match and payload differs", async () => {
    const { remote, current } = await seedCreated();
    const first = await mutateAppointmentSafely(
      commandFor(remote, current, {
        kind: "transition",
        appointmentId: current.id,
        expectedUpdatedAt: current.updatedAt,
        status: "CONFIRMED",
      }),
      remote,
    );
    await expect(
      mutateAppointmentSafely(
        commandFor(remote, current, {
          kind: "cancel",
          appointmentId: current.id,
          expectedUpdatedAt: current.updatedAt,
        }),
        remote,
      ),
    ).rejects.toBeInstanceOf(AppointmentWriteStaleError);
    expect(first.appointment.status).toBe("CONFIRMED");
  });

  it("replays an already-applied mutation after a zero-row UPDATE", async () => {
    const { remote, current } = await seedCreated();
    const prepared = commandFor(remote, current, {
      kind: "cancel",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
    });
    const first = await mutateAppointmentSafely(prepared, remote);
    expect(first.appointment.status).toBe("CANCELLED");
    expect(first.appointment.cancelledBy).toBe(STAFF_A);

    const zeroHost: AppointmentMutateHost = {
      appointments: {
        get: (org, id) => remote.appointments.get(org, id),
        update: async () => {
          throw new AppointmentWriteZeroRowError();
        },
      },
    };
    const replayed = await mutateAppointmentSafely(prepared, zeroHost);
    expect(replayed.outcome).toBe("replayed");
    expect(replayed.appointment.status).toBe("CANCELLED");
    expect(appointmentMatchesPreparedMutate(replayed.appointment, prepared)).toBe(true);
  });

  it("reconciles an unknown commit without generating a new payload", async () => {
    const { remote, db, current } = await seedCreated();
    const prepared = commandFor(remote, current, {
      kind: "transition",
      appointmentId: current.id,
      expectedUpdatedAt: current.updatedAt,
      status: "ARRIVED",
    });
    let attempts = 0;
    const host: AppointmentMutateHost = {
      appointments: {
        get: (org, id) => remote.appointments.get(org, id),
        update: async (org, input) => {
          attempts += 1;
          if (attempts === 1) throw new Error("timeout");
          return remote.appointments.update(org, input);
        },
      },
    };
    await expect(mutateAppointmentSafely(prepared, host)).rejects.toBeInstanceOf(
      AppointmentWriteRetryableError,
    );
    expect(attempts).toBe(1);
    expect(db.appointments).toHaveLength(1);
    expect(db.appointments[0]?.status).toBe("BOOKED");
    expect(prepared.expectedUpdatedAt).toBe(current.updatedAt);

    const landedHost: AppointmentMutateHost = {
      appointments: {
        get: (org, id) => remote.appointments.get(org, id),
        update: async (org, input) => {
          await remote.appointments.update(org, input);
          throw new Error("Failed to fetch");
        },
      },
    };
    const recovered = await mutateAppointmentSafely(prepared, landedHost);
    expect(recovered.outcome).toBe("replayed");
    expect(recovered.appointment.status).toBe("ARRIVED");
    expect(recovered.appointment.updatedAt).not.toBe(prepared.expectedUpdatedAt);
  });

  it("maps 23P01 to AppointmentConflictError without retry or upsert", async () => {
    const { remote, db, current } = await seedCreated("apt-first1-abcdef");
    await createAppointmentSafely(
      prepareAppointmentCreateCommand(
        {
          organizationId: ORG_A,
          locationId: LOC_A1,
          customerId: CUST_SHARED,
          serviceId: SVC_SHARED,
          staffId: STAFF_A,
          appointmentId: "apt-other1-abcdef",
          dateYmd: "2026-10-09",
          startHm: "14:00",
          durationMinutes: 60,
        },
        { mapper: remote.mapper, snapshots: snapshots() },
      ),
      remote,
    );
    await expect(
      mutateAppointmentSafely(
        commandFor(remote, current, {
          kind: "reschedule",
          appointmentId: current.id,
          expectedUpdatedAt: current.updatedAt,
          dateYmd: "2026-10-09",
          startHm: "14:00",
          durationMinutes: 60,
        }),
        remote,
      ),
    ).rejects.toMatchObject({ name: "AppointmentConflictError", sqlstate: "23P01" });
    expect(db.getAppointmentByAppId(remote.mapper.resolveOrganizationDbId(ORG_A), current.id)?.starts_at).toBe(
      current.startAt,
    );

    const failing: AppointmentMutateHost = {
      appointments: {
        get: (org, id) => remote.appointments.get(org, id),
        update: async () => {
          throw new Error("23P01 exclusion_violation");
        },
      },
    };
    await expect(
      mutateAppointmentSafely(
        commandFor(remote, current, {
          kind: "reschedule",
          appointmentId: current.id,
          expectedUpdatedAt: current.updatedAt,
          dateYmd: "2026-10-09",
          startHm: "15:00",
          durationMinutes: 60,
        }),
        failing,
      ),
    ).rejects.toBeInstanceOf(AppointmentConflictError);
  });

  it("fails closed when the row is missing and does not write localStorage", async () => {
    const { remote, current } = await seedCreated("apt-gone01-abcdef");
    const missing: AppointmentMutateHost = {
      appointments: {
        get: async () => undefined,
        update: async () => {
          throw new AppointmentWriteZeroRowError();
        },
      },
    };
    await expect(
      mutateAppointmentSafely(
        commandFor(remote, current, {
          kind: "cancel",
          appointmentId: current.id,
          expectedUpdatedAt: current.updatedAt,
        }),
        missing,
      ),
    ).rejects.toBeInstanceOf(AppointmentWriteNotFoundError);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID }).some((row) => row.id === current.id),
    ).toBe(false);
    expect(updateAppointment).not.toBe(mutateAppointmentSafely);
    expect(createAppointment).not.toBe(mutateAppointmentSafely);
  });

  it("authorizes current and new locations and isolates organizations", async () => {
    const { remote, current } = await seedCreated();
    expect(() =>
      commandFor(remote, current, {
        kind: "reschedule",
        appointmentId: current.id,
        expectedUpdatedAt: current.updatedAt,
        dateYmd: "2026-10-09",
        startHm: "15:00",
        durationMinutes: 60,
        locationId: LOC_B1,
      }),
    ).toThrow(/Unmapped location/);
    expect(() =>
      prepareAppointmentMutateCommand(
        {
          kind: "cancel",
          appointmentId: current.id,
          expectedUpdatedAt: current.updatedAt,
          organizationId: ORG_B,
        },
        current,
        {
          mapper: remote.mapper,
          snapshots: snapshots(),
          organizationId: ORG_A,
          updatedBy: STAFF_A,
        },
      ),
    ).toThrow(/authenticated organization/);
  });

  it("keeps the existing remote create path insert-only and does not upsert", async () => {
    const { db } = await seedCreated("apt-create-abcdef");
    expect(db.appointments).toHaveLength(1);
    const create = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-create.ts"),
      "utf8",
    );
    const mutate = readFileSync(
      path.join(process.cwd(), "lib/appointments/appointment-write-mutate.ts"),
      "utf8",
    );
    const adapter = readFileSync(
      path.join(process.cwd(), "lib/persistence/appointment-remote-adapter.ts"),
      "utf8",
    );
    expect(create).not.toMatch(/\.upsert\(/);
    expect(mutate).not.toMatch(/\.upsert\(/);
    expect(mutate).not.toMatch(/hasAppointmentConflict\(|allowConflict:|localStorage/);
    expect(adapter).not.toMatch(/\.upsert\(/);
    expect(adapter).toMatch(/getAppointmentByAppId/);
    expect(adapter).toMatch(/verifiedDbUuid: current.id/);
    expect(create).toMatch(/createAppointmentSafely/);
  });
});
