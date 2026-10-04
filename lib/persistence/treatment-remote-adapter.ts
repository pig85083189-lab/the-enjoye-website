/**
 * Canonical treatment remote adapter.
 * Fail-closed: unmapped org/location/customer/service/appointment throw BEFORE insert.
 * Never auto-creates customers or appointments. Never enabled in live UI.
 * Photos are metadata-only. No Storage writes. No service role.
 */

import type { TreatmentDraft } from "@/types/treatment";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { newId } from "@/lib/repositories/storage";
import {
  TreatmentAppointmentImmutableError,
  TreatmentCompletedImmutableError,
  TreatmentCustomerImmutableError,
  TreatmentDuplicateError,
  TreatmentLocationImmutableError,
  TreatmentWriteNotFoundError,
  TreatmentWriteZeroRowError,
  TREATMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE,
  TREATMENT_INSERT_ONLY_MESSAGE,
} from "@/lib/treatments/treatment-write-errors";
import {
  assertNotDemoResiduePayload,
  assertRemoteCustomerAllowed,
  assertRemoteTreatmentAllowed,
} from "./demo-firewall";
import type { CanonicalIdMapper } from "./identity-map";
import type {
  AppointmentTableStore,
  DbTreatment,
  TreatmentTableStore,
} from "./operational-rows";
import {
  assertMappedTreatmentDependencies,
  clinicalPatchFromDraft,
  remoteTreatmentPayload,
  sanitizeTreatmentMutatePatch,
  toRemoteTemplateType,
  toRemoteTreatmentStatus,
  treatmentFromRemoteRow,
} from "./treatment-mapping";

export type TreatmentRemoteCreateInput = {
  id?: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId?: string;
  createdBy?: string;
  templateType?: string;
  draft?: Partial<TreatmentDraft>;
};

export type TreatmentRemoteUpdateInput = {
  treatmentId: string;
  expectedUpdatedAt: string;
  updatedBy: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId?: string;
  draft: TreatmentDraft;
  dbId?: string;
};

export class TreatmentRemoteAdapter {
  constructor(
    private readonly mapper: CanonicalIdMapper,
    private readonly store: TreatmentTableStore,
    private readonly appointments: Pick<
      AppointmentTableStore,
      "getAppointmentByAppId" | "getAppointmentByDbId"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(organizationId: string): Promise<TreatmentDraft[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const rows = await this.store.listTreatments(orgDbId);
    return Promise.all(rows.map((row) => this.toDomain(organizationId, row)));
  }

  async listByCustomerId(
    organizationId: string,
    customerId: string,
  ): Promise<TreatmentDraft[]> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const customerDbId = this.mapper.resolveCustomerDbId(organizationId, customerId);
    const scoped = this.store as TreatmentTableStore & {
      listTreatmentsByCustomer?(
        organizationDbId: string,
        customerDbId: string,
      ): Promise<DbTreatment[]> | DbTreatment[];
    };
    const rows = scoped.listTreatmentsByCustomer
      ? await scoped.listTreatmentsByCustomer(orgDbId, customerDbId)
      : (await this.store.listTreatments(orgDbId)).filter(
          (row) => row.customer_id === customerDbId,
        );
    return Promise.all(rows.map((row) => this.toDomain(organizationId, row)));
  }

  async get(organizationId: string, treatmentId: string): Promise<TreatmentDraft | undefined> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const row = await this.store.getTreatmentByAppId(orgDbId, treatmentId);
    if (!row) return undefined;
    return this.toDomain(organizationId, row);
  }

  async getByAppointmentId(
    organizationId: string,
    appointmentId: string,
  ): Promise<TreatmentDraft | undefined> {
    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const appointment = await this.appointments.getAppointmentByAppId(orgDbId, appointmentId);
    if (!appointment || appointment.organization_id !== orgDbId) return undefined;
    const row = await this.store.getTreatmentByAppointmentId(orgDbId, appointment.id);
    if (!row) return undefined;
    return this.toDomain(organizationId, row);
  }

  async create(
    organizationId: string,
    input: TreatmentRemoteCreateInput,
  ): Promise<TreatmentDraft> {
    assertNotDemoResiduePayload(input);
    const treatmentId = input.id ?? newId("trt");
    assertRemoteTreatmentAllowed({
      id: treatmentId,
      customerId: input.customerId,
      appointmentId: input.appointmentId,
    });
    assertRemoteCustomerAllowed({ id: input.customerId });

    const mapped = assertMappedTreatmentDependencies(this.mapper, organizationId, input);
    const staffId = this.mapper.requireOperationalStaffId(organizationId, input.staffId);
    const createdBy = input.createdBy
      ? this.mapper.requireOperationalStaffId(organizationId, input.createdBy)
      : staffId;

    const appointmentDbId = input.appointmentId
      ? await this.requireMatchingAppointment({
          organizationId,
          organizationDbId: mapped.organizationDbId,
          appointmentAppId: input.appointmentId,
          customerDbId: mapped.customerDbId,
          locationDbId: mapped.locationDbId,
        })
      : null;

    if (appointmentDbId) {
      const existingForAppointment = await this.store.getTreatmentByAppointmentId(
        mapped.organizationDbId,
        appointmentDbId,
      );
      if (existingForAppointment) {
        throw new TreatmentDuplicateError();
      }
    }

    const existing = await this.store.getTreatmentByAppId(
      mapped.organizationDbId,
      treatmentId,
    );
    if (existing) {
      throw new Error(TREATMENT_INSERT_ONLY_MESSAGE);
    }

    const draft = input.draft;
    const stamp = this.now().toISOString();
    const row: DbTreatment = {
      id: crypto.randomUUID(),
      organization_id: mapped.organizationDbId,
      location_id: mapped.locationDbId,
      appointment_id: appointmentDbId,
      customer_id: mapped.customerDbId,
      service_id: mapped.serviceDbId,
      staff_id: staffId,
      app_id: treatmentId,
      mode: draft?.mode === "QUICK" ? "QUICK" : "STANDARD",
      template_type: toRemoteTemplateType(input.templateType),
      assessment: (draft?.assessment as Record<string, unknown> | undefined) ?? {},
      body_markers: draft?.bodyMarkers ?? [],
      operations: draft?.operations ?? [],
      products: draft?.products ?? [],
      professional_note: draft?.professionalNote || null,
      client_feeling: draft?.clientFeeling || null,
      follow_up: (draft?.followUp as Record<string, unknown> | undefined) ?? {},
      skipped_steps: draft?.skippedSteps ?? [],
      started_at: stamp,
      completed_at: null,
      status: "DRAFT",
      body_map_note: draft?.bodyMapNote || null,
      discomfort_note: draft?.discomfortNote || null,
      furthest_step: draft?.furthestStep ?? "summary",
      current_step: draft?.currentStep ?? "summary",
      created_by: createdBy,
      updated_by: createdBy,
      suggested_tracking_areas: draft?.suggestedTrackingAreas ?? [],
      selected_quick_phrases: draft?.selectedQuickPhrases ?? [],
      note_manually_edited: Boolean(draft?.noteManuallyEdited),
      quick_record_applied_at: draft?.quickRecordAppliedAt ?? null,
      photo_meta: draft?.photos ? draft.photos.map((photo) => ({
        id: photo.id,
        treatmentId,
        type: photo.type,
        createdAt: photo.createdAt,
        hadPreview: Boolean(photo.hadPreview),
      })) : [],
      created_at: stamp,
      updated_at: stamp,
    };
    remoteTreatmentPayload(row);
    await this.store.insertTreatment(row);
    this.mapper.rememberTreatment(mapped.organizationDbId, row.app_id, row.id);
    return this.toDomain(organizationId, row);
  }

  async update(
    organizationId: string,
    input: TreatmentRemoteUpdateInput,
  ): Promise<TreatmentDraft> {
    const expectedUpdatedAt = input.expectedUpdatedAt?.trim() ?? "";
    if (!expectedUpdatedAt) {
      throw new Error(TREATMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE);
    }

    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const current = await this.store.getTreatmentByAppId(orgDbId, input.treatmentId);
    if (!current || current.organization_id !== orgDbId) {
      throw new TreatmentWriteNotFoundError();
    }
    if (input.dbId && input.dbId !== current.id) {
      throw new TreatmentWriteNotFoundError(
        "Client DB UUID does not match the treatment resolved by organization + app_id",
      );
    }
    if (current.status === "COMPLETED") {
      throw new TreatmentCompletedImmutableError();
    }

    this.assertLocationAuthorized(organizationId, current.location_id);
    const mapped = assertMappedTreatmentDependencies(this.mapper, organizationId, {
      locationId: input.locationId,
      customerId: input.customerId,
      serviceId: input.serviceId,
    });
    if (mapped.locationDbId !== current.location_id) {
      throw new TreatmentLocationImmutableError();
    }
    if (mapped.customerDbId !== current.customer_id) {
      throw new TreatmentCustomerImmutableError();
    }
    if (input.appointmentId) {
      const appointmentDbId = await this.requireMatchingAppointment({
        organizationId,
        organizationDbId: orgDbId,
        appointmentAppId: input.appointmentId,
        customerDbId: current.customer_id,
        locationDbId: current.location_id,
      });
      if (appointmentDbId !== current.appointment_id) {
        throw new TreatmentAppointmentImmutableError();
      }
    } else if (current.appointment_id) {
      throw new TreatmentAppointmentImmutableError();
    }

    const staffId = this.mapper.requireOperationalStaffId(organizationId, input.staffId);
    const updatedBy = this.mapper.requireOperationalStaffId(organizationId, input.updatedBy);
    const patch = sanitizeTreatmentMutatePatch({
      ...clinicalPatchFromDraft(input.draft),
      service_id: mapped.serviceDbId,
      staff_id: staffId,
      updated_by: updatedBy,
      status: "DRAFT",
      completed_at: null,
    });

    const updatedRows = await this.store.updateTreatment({
      verifiedDbUuid: current.id,
      organizationDbId: orgDbId,
      expectedUpdatedAt,
      patch,
    });
    if (updatedRows.length === 1) {
      const row = updatedRows[0]!;
      this.mapper.rememberTreatment(orgDbId, row.app_id, row.id);
      return this.toDomain(organizationId, row);
    }
    if (updatedRows.length === 0) {
      throw new TreatmentWriteZeroRowError();
    }
    throw new Error("Treatment update returned an unexpected number of rows");
  }

  async complete(
    organizationId: string,
    input: TreatmentRemoteUpdateInput,
  ): Promise<TreatmentDraft> {
    const expectedUpdatedAt = input.expectedUpdatedAt?.trim() ?? "";
    if (!expectedUpdatedAt) {
      throw new Error(TREATMENT_EXPECTED_UPDATED_AT_REQUIRED_MESSAGE);
    }

    const orgDbId = this.mapper.resolveOrganizationDbId(organizationId);
    const current = await this.store.getTreatmentByAppId(orgDbId, input.treatmentId);
    if (!current || current.organization_id !== orgDbId) {
      throw new TreatmentWriteNotFoundError();
    }
    if (current.status === "COMPLETED") {
      throw new TreatmentCompletedImmutableError();
    }

    this.assertLocationAuthorized(organizationId, current.location_id);
    const mapped = assertMappedTreatmentDependencies(this.mapper, organizationId, {
      locationId: input.locationId,
      customerId: input.customerId,
      serviceId: input.serviceId,
    });
    if (mapped.customerDbId !== current.customer_id) {
      throw new TreatmentCustomerImmutableError();
    }
    if (mapped.locationDbId !== current.location_id) {
      throw new TreatmentLocationImmutableError();
    }

    const staffId = this.mapper.requireOperationalStaffId(organizationId, input.staffId);
    const updatedBy = this.mapper.requireOperationalStaffId(organizationId, input.updatedBy);
    const stamp = this.now().toISOString();
    const completedDraft: TreatmentDraft = {
      ...input.draft,
      status: "completed",
      currentStep: "complete",
      furthestStep: "complete",
    };
    const patch = sanitizeTreatmentMutatePatch({
      ...clinicalPatchFromDraft(completedDraft),
      service_id: mapped.serviceDbId,
      staff_id: staffId,
      updated_by: updatedBy,
      status: toRemoteTreatmentStatus("completed"),
      completed_at: stamp,
      current_step: "complete",
      furthest_step: "complete",
    });

    const updatedRows = await this.store.updateTreatment({
      verifiedDbUuid: current.id,
      organizationDbId: orgDbId,
      expectedUpdatedAt,
      patch,
    });
    if (updatedRows.length === 1) {
      const row = updatedRows[0]!;
      this.mapper.rememberTreatment(orgDbId, row.app_id, row.id);
      return this.toDomain(organizationId, row);
    }
    if (updatedRows.length === 0) {
      throw new TreatmentWriteZeroRowError();
    }
    throw new Error("Treatment complete returned an unexpected number of rows");
  }

  private async requireMatchingAppointment(input: {
    organizationId: string;
    organizationDbId: string;
    appointmentAppId: string;
    customerDbId: string;
    locationDbId: string;
  }): Promise<string> {
    const appointment = await this.appointments.getAppointmentByAppId(
      input.organizationDbId,
      input.appointmentAppId,
    );
    if (!appointment || appointment.organization_id !== input.organizationDbId) {
      throw new TreatmentWriteNotFoundError("Treatment appointment is not in this organization");
    }
    if (appointment.customer_id !== input.customerDbId) {
      throw new TreatmentCustomerImmutableError(
        "Treatment customer must match the appointment customer",
      );
    }
    if (appointment.location_id !== input.locationDbId) {
      throw new TreatmentLocationImmutableError(
        "Treatment location must match the appointment location",
      );
    }
    this.mapper.rememberAppointment(
      input.organizationDbId,
      appointment.app_id,
      appointment.id,
    );
    return appointment.id;
  }

  private assertLocationAuthorized(organizationId: string, locationDbId: string): void {
    const locationAppId = this.mapper.toLocationAppId(locationDbId);
    this.mapper.resolveLocationDbId(organizationId, locationAppId);
  }

  private async toDomain(organizationAppId: string, row: DbTreatment): Promise<TreatmentDraft> {
    const locationAppId = this.mapper.toLocationAppId(row.location_id);
    const customerAppId = this.mapper.toCustomerAppId(row.customer_id);
    const serviceAppId = this.mapper.toServiceAppId(row.service_id);
    let appointmentAppId = "";
    if (row.appointment_id) {
      const appointment = await this.appointments.getAppointmentByDbId(row.appointment_id);
      if (!appointment || appointment.organization_id !== row.organization_id) {
        throw new TreatmentWriteNotFoundError("Treatment appointment mapping is missing");
      }
      appointmentAppId = appointment.app_id;
      this.mapper.rememberAppointment(row.organization_id, appointment.app_id, appointment.id);
    }
    const domain = treatmentFromRemoteRow(
      organizationAppId,
      locationAppId,
      customerAppId,
      serviceAppId,
      appointmentAppId,
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
    this.mapper.rememberTreatment(row.organization_id, row.app_id, row.id);
    return domain;
  }
}
