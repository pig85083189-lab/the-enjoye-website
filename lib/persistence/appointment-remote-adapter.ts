/**
 * Canonical appointment remote adapter.
 * Fail-closed: unmapped org/location/customer/service must throw BEFORE insert.
 * Never auto-creates customers or services. Never enabled in live UI.
 * Database composite FKs / staff trigger are the final tenant-integrity authority;
 * this adapter stays as defense-in-depth and is not weakened by the DB hardening.
 */

import type { AppointmentListQuery, CreateAppointmentInput } from "@/lib/appointments/store";
import { durationBetween, type ScheduleAppointment } from "@/lib/appointments/domain";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { newId } from "@/lib/repositories/storage";
import {
  assertNotDemoResiduePayload,
  assertRemoteAppointmentAllowed,
} from "./demo-firewall";
import type { CanonicalIdMapper } from "./identity-map";
import {
  appointmentFromRemoteRow,
  assertAppointmentTimeRange,
  assertMappedAppointmentDependencies,
  mergeInternalNote,
  remoteAppointmentPayload,
  toRemoteAppointmentStatus,
} from "./appointment-mapping";
import type { AppointmentTableStore, DbAppointment } from "./operational-rows";

export class AppointmentRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: AppointmentTableStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: AppointmentListQuery): Promise<ScheduleAppointment[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(query.organizationId);
    const rows = await this.store.listAppointments(orgDbId);
    const mapped = rows.map((row) => this.toDomain(query.organizationId, row));
    return mapped.filter((item) => {
      if (query.locationId && item.locationId !== query.locationId) return false;
      if (query.staffId && item.staffId !== query.staffId) return false;
      if (query.customerId && item.customerId !== query.customerId) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.from || query.to) {
        const t = new Date(item.startAt).getTime();
        const from = query.from?.getTime() ?? Number.NEGATIVE_INFINITY;
        const to = query.to?.getTime() ?? Number.POSITIVE_INFINITY;
        if (t < from || t > to) return false;
      }
      return true;
    });
  }

  async get(organizationId: string, appointmentId: string): Promise<ScheduleAppointment | undefined> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const row = await this.store.getAppointmentByAppId(orgDbId, appointmentId);
    if (!row) return undefined;
    return this.toDomain(organizationId, row);
  }

  /**
   * Location + overlapping timestamptz window. Maps loc-* app id → location UUID
   * and filters on location_id / starts_at / ends_at when the store supports it.
   */
  async listByLocationAndRange(input: {
    organizationId: string;
    locationAppId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<ScheduleAppointment[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(input.organizationId);
    const locationDbId = this.mapper.resolveLocationDbId(
      input.organizationId,
      input.locationAppId,
    );
    const scoped = this.store as AppointmentTableStore & {
      listAppointmentsByLocationAndRange?(args: {
        organizationDbId: string;
        locationDbId: string;
        startsAt: string;
        endsAt: string;
      }): Promise<DbAppointment[]>;
    };
    const rows = scoped.listAppointmentsByLocationAndRange
      ? await scoped.listAppointmentsByLocationAndRange({
          organizationDbId: orgDbId,
          locationDbId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        })
      : (await this.store.listAppointments(orgDbId)).filter((row) => {
          if (row.location_id !== locationDbId) return false;
          const start = new Date(row.starts_at).getTime();
          const end = new Date(row.ends_at).getTime();
          const from = new Date(input.startsAt).getTime();
          const to = new Date(input.endsAt).getTime();
          return start < to && end > from;
        });
    return rows.map((row) => this.toDomain(input.organizationId, row));
  }

  /**
   * Customer-scoped read. Filters on mapped customer_id FK, never snapshots.
   * Uses store.listAppointmentsByCustomer when the store exposes it.
   */
  async listByCustomerId(
    organizationId: string,
    customerId: string,
  ): Promise<ScheduleAppointment[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const customerDbId = this.mapper.resolveCustomerDbId(organizationId, customerId);
    const scoped = this.store as AppointmentTableStore & {
      listAppointmentsByCustomer?(
        organizationDbId: string,
        customerDbId: string,
      ): Promise<DbAppointment[]>;
    };
    const rows = scoped.listAppointmentsByCustomer
      ? await scoped.listAppointmentsByCustomer(orgDbId, customerDbId)
      : (await this.store.listAppointments(orgDbId)).filter(
          (row) => row.customer_id === customerDbId,
        );
    return rows.map((row) => this.toDomain(organizationId, row));
  }

  async create(
    organizationId: string,
    input: CreateAppointmentInput &
      Partial<
        Pick<
          ScheduleAppointment,
          | "id"
          | "customerName"
          | "serviceName"
          | "staffName"
          | "status"
          | "notes"
          | "updatedBy"
          | "cancelledBy"
          | "statusReason"
        >
      >,
  ): Promise<ScheduleAppointment> {
    assertNotDemoResiduePayload(input);
    const appointmentId = input.id ?? newId("apt");
    assertRemoteAppointmentAllowed({
      id: appointmentId,
      customerId: input.customerId,
      customerName: input.customerName,
    });
    assertAppointmentTimeRange(input.startAt, input.endAt);

    const { organizationDbId: orgDbId, locationDbId, customerDbId, serviceDbId } =
      assertMappedAppointmentDependencies(this.mapper, organizationId, input);
    const staffId = this.mapper.requireOperationalStaffId(organizationId, input.staffId);
    const createdBy = input.createdBy
      ? this.mapper.requireOperationalStaffId(organizationId, input.createdBy)
      : staffId;
    const updatedBy = input.updatedBy
      ? this.mapper.requireOperationalStaffId(organizationId, input.updatedBy)
      : undefined;
    const cancelledBy = input.cancelledBy
      ? this.mapper.requireOperationalStaffId(organizationId, input.cancelledBy)
      : undefined;

    const stamp = this.now().toISOString();
    const row: DbAppointment = {
      id: crypto.randomUUID(),
      organization_id: orgDbId,
      location_id: locationDbId,
      customer_id: customerDbId,
      service_id: serviceDbId,
      staff_id: staffId,
      app_id: appointmentId,
      starts_at: input.startAt,
      ends_at: input.endAt,
      duration_minutes: durationBetween(input.startAt, input.endAt),
      status: toRemoteAppointmentStatus(input.status ?? "BOOKED"),
      customer_note: input.customerNote?.trim() || null,
      internal_note: mergeInternalNote({
        internalNote: input.internalNote,
        notes: input.notes ?? [],
      }),
      customer_name_snapshot: input.customerName ?? null,
      service_name_snapshot: input.serviceName ?? null,
      staff_name_snapshot: input.staffName ?? null,
      status_reason: input.statusReason ?? null,
      cancelled_at: null,
      cancelled_by: cancelledBy ?? null,
      created_by: createdBy,
      updated_by: updatedBy ?? null,
      created_at: stamp,
      updated_at: stamp,
    };
    remoteAppointmentPayload(row);
    await this.store.insertAppointment(row);
    this.mapper.rememberAppointment(orgDbId, row.app_id, row.id);
    return this.toDomain(organizationId, row);
  }

  private toDomain(organizationAppId: string, row: DbAppointment): ScheduleAppointment {
    const locationAppId = row.location_id
      ? this.mapper.toLocationAppId(row.location_id)
      : "";
    const customerAppId = this.mapper.toCustomerAppId(row.customer_id);
    const serviceAppId = this.mapper.toServiceAppId(row.service_id);
    const domain = appointmentFromRemoteRow(
      organizationAppId,
      locationAppId,
      customerAppId,
      serviceAppId,
      row,
    );
    if (domain.staffId) {
      try {
        domain.staffId = this.mapper.requireOperationalStaffId(
          organizationAppId,
          domain.staffId,
        );
      } catch {
        if (isAuthUuid(domain.staffId)) {
          domain.staffId = "";
        }
      }
    }
    return domain;
  }
}
