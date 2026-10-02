/**
 * Temporary Preview-only first-appointment bootstrap.
 * Explicit authenticated Owner path. Does not change getPersistenceDriver()
 * or enable remote persistence flags. Live Calendar / Today stay local.
 * Service role is never used for Appointment writes.
 */

import {
  APPOINTMENT_STAFF_OVERLAP_MESSAGE,
  createAppointmentRecord,
} from "@/lib/appointments/appointment-queries";
import {
  buildFutureFirstAppointmentDomainInput,
  FUTURE_QA_APPOINTMENT,
  futureQaAppointmentUtcRange,
} from "@/lib/appointments/remote-readiness";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  loadAuthenticatedIdentityCatalog,
  type IdentitySupabaseClient,
} from "@/lib/persistence/authenticated-identity-catalog";
import {
  AuthenticatedAppointmentTableStore,
  type AuthenticatedAppointmentSupabaseClient,
} from "@/lib/persistence/authenticated-appointment-store";
import { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import { assertMappedAppointmentDependencies } from "@/lib/persistence/appointment-mapping";
import {
  addMinutesToIso,
  APPOINTMENT_DISPLAY_TIMEZONE,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "@/lib/persistence/appointment-time";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";

export const APPOINTMENT_BOOTSTRAP_ROUTE = "/staff/appointment-bootstrap";

export const BOOTSTRAP_TARGET = {
  organizationAppId: FUTURE_QA_APPOINTMENT.organizationAppId,
  organizationDbId: FUTURE_QA_APPOINTMENT.organizationDbId,
  locationAppId: FUTURE_QA_APPOINTMENT.locationAppId,
  locationDbId: FUTURE_QA_APPOINTMENT.locationDbId,
  locationName: "THE ENJOYE 主店",
  customerAppId: FUTURE_QA_APPOINTMENT.customerAppId,
  customerDbId: FUTURE_QA_APPOINTMENT.customerDbId,
  customerName: FUTURE_QA_APPOINTMENT.customerName,
  serviceAppId: FUTURE_QA_APPOINTMENT.serviceAppId,
  serviceDbId: FUTURE_QA_APPOINTMENT.serviceDbId,
  serviceName: FUTURE_QA_APPOINTMENT.serviceName,
  operationalStaffId: FUTURE_QA_APPOINTMENT.staffAppId,
  staffName: FUTURE_QA_APPOINTMENT.staffName,
  role: "OWNER",
} as const;

export const BOOTSTRAP_UNRELATED_ORG_UUID = "00000000-0000-4000-8000-000000000001";
export const BOOTSTRAP_UNRELATED_LOC_UUID = "00000000-0000-4000-8000-000000000002";

export const FIRST_REMOTE_APPOINTMENT_PAYLOAD = buildFutureFirstAppointmentDomainInput();

export type BootstrapRlsCheck = {
  organizationMembership: boolean | null;
  organizationRole: string | null;
  locationAccess: boolean | null;
  unrelatedOrganizationMembership: boolean | null;
  unrelatedLocationAccess: boolean | null;
};

export type BootstrapIdentityView = {
  authenticated: true;
  operationalStaffId: string;
  role: string;
  organizationAppId: string;
  locationAppId: string;
};

export type AppointmentMappingView = {
  organizationAppId: string;
  organizationDbId: string;
  locationAppId: string;
  locationDbId: string;
  customerAppId: string;
  customerDbId: string;
  serviceAppId: string;
  serviceDbId: string;
  staffAppId: string;
};

export type TaipeiDisplayView = {
  date: string;
  range: string;
  timezone: string;
  startAt: string;
  endAt: string;
};

export type ExistingOrCreatedAppointment = {
  status: "existing" | "created";
  appointment: ScheduleAppointment;
  mapping: AppointmentMappingView;
};

export type AppointmentBootstrapClient = IdentitySupabaseClient &
  AuthenticatedAppointmentSupabaseClient & {
    rpc(
      fn: string,
      args: Record<string, string>,
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asRole(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function qaAppointmentTimeIsSafe(): boolean {
  const startAt = taipeiLocalToUtcIso(
    FUTURE_QA_APPOINTMENT.localDateYmd,
    FUTURE_QA_APPOINTMENT.localStartHm,
  );
  const endAt = addMinutesToIso(startAt, FUTURE_QA_APPOINTMENT.durationMinutes);
  const localEnd = utcIsoToTaipeiLocal(endAt);
  return (
    startAt === "2026-10-09T02:00:00.000Z" &&
    endAt === "2026-10-09T03:40:00.000Z" &&
    localEnd.dateYmd === "2026-10-09" &&
    localEnd.hm === "11:40" &&
    APPOINTMENT_DISPLAY_TIMEZONE === "Asia/Taipei"
  );
}

export function qaAppointmentTaipeiDisplay(): TaipeiDisplayView {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return {
    date: "2026/10/09",
    range: "10:00–11:40",
    timezone: APPOINTMENT_DISPLAY_TIMEZONE,
    startAt,
    endAt,
  };
}

export function rlsPrecheckPassed(check: BootstrapRlsCheck): boolean {
  return (
    check.organizationMembership === true &&
    check.organizationRole === BOOTSTRAP_TARGET.role &&
    check.locationAccess === true &&
    check.unrelatedOrganizationMembership === false &&
    check.unrelatedLocationAccess === false
  );
}

export function mappingPrecheckPassed(mapping: AppointmentMappingView): boolean {
  return (
    mapping.organizationAppId === BOOTSTRAP_TARGET.organizationAppId &&
    mapping.organizationDbId === BOOTSTRAP_TARGET.organizationDbId &&
    mapping.locationAppId === BOOTSTRAP_TARGET.locationAppId &&
    mapping.locationDbId === BOOTSTRAP_TARGET.locationDbId &&
    mapping.customerAppId === BOOTSTRAP_TARGET.customerAppId &&
    mapping.customerDbId === BOOTSTRAP_TARGET.customerDbId &&
    mapping.serviceAppId === BOOTSTRAP_TARGET.serviceAppId &&
    mapping.serviceDbId === BOOTSTRAP_TARGET.serviceDbId &&
    mapping.staffAppId === BOOTSTRAP_TARGET.operationalStaffId &&
    !isAuthUuid(mapping.staffAppId)
  );
}

export function canShowCreateButton(input: {
  rlsPassed: boolean;
  mappingPassed: boolean;
  timeSafe: boolean;
  existing: boolean;
  conflict: boolean;
}): boolean {
  return (
    input.rlsPassed &&
    input.mappingPassed &&
    input.timeSafe &&
    !input.existing &&
    !input.conflict
  );
}

export async function runAuthenticatedOwnerRlsPrecheck(
  client: AppointmentBootstrapClient,
): Promise<BootstrapRlsCheck> {
  const { data: hasOrg } = await client.rpc("user_has_org_membership", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
  });
  const { data: orgRole } = await client.rpc("user_org_role", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
  });
  const { data: canLoc } = await client.rpc("user_can_access_location", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
    target_loc: BOOTSTRAP_TARGET.locationDbId,
  });
  const { data: hasWrongOrg } = await client.rpc("user_has_org_membership", {
    target_org: BOOTSTRAP_UNRELATED_ORG_UUID,
  });
  const { data: canWrongLoc } = await client.rpc("user_can_access_location", {
    target_org: BOOTSTRAP_TARGET.organizationDbId,
    target_loc: BOOTSTRAP_UNRELATED_LOC_UUID,
  });
  return {
    organizationMembership: asBoolean(hasOrg),
    organizationRole: asRole(orgRole),
    locationAccess: asBoolean(canLoc),
    unrelatedOrganizationMembership: asBoolean(hasWrongOrg),
    unrelatedLocationAccess: asBoolean(canWrongLoc),
  };
}

export function createExplicitAuthenticatedAppointmentAdapter(
  client: AppointmentBootstrapClient,
  mapper: CanonicalIdMapper,
): AppointmentRemoteAdapter {
  return new AppointmentRemoteAdapter(mapper, new AuthenticatedAppointmentTableStore(client));
}

export function resolveQaAppointmentMapping(mapper: CanonicalIdMapper): AppointmentMappingView {
  const input = FIRST_REMOTE_APPOINTMENT_PAYLOAD;
  const resolved = assertMappedAppointmentDependencies(
    mapper,
    BOOTSTRAP_TARGET.organizationAppId,
    input,
  );
  const staffAppId = mapper.requireOperationalStaffId(
    BOOTSTRAP_TARGET.organizationAppId,
    BOOTSTRAP_TARGET.operationalStaffId,
  );
  return {
    organizationAppId: BOOTSTRAP_TARGET.organizationAppId,
    organizationDbId: resolved.organizationDbId,
    locationAppId: BOOTSTRAP_TARGET.locationAppId,
    locationDbId: resolved.locationDbId,
    customerAppId: BOOTSTRAP_TARGET.customerAppId,
    customerDbId: resolved.customerDbId,
    serviceAppId: BOOTSTRAP_TARGET.serviceAppId,
    serviceDbId: resolved.serviceDbId,
    staffAppId,
  };
}

export function isExactQaAppointment(
  appointment: Pick<ScheduleAppointment, "customerId" | "serviceId" | "staffId" | "startAt">,
): boolean {
  const { startAt } = futureQaAppointmentUtcRange();
  return (
    appointment.customerId === BOOTSTRAP_TARGET.customerAppId &&
    appointment.serviceId === BOOTSTRAP_TARGET.serviceAppId &&
    appointment.staffId === BOOTSTRAP_TARGET.operationalStaffId &&
    appointment.startAt === startAt
  );
}

export async function findExactQaAppointment(
  adapter: AppointmentRemoteAdapter,
): Promise<ScheduleAppointment | undefined> {
  const rows = await adapter.list({ organizationId: BOOTSTRAP_TARGET.organizationAppId });
  return rows.find(isExactQaAppointment);
}

function mappingFor(
  mapper: CanonicalIdMapper,
  appointment: ScheduleAppointment,
): AppointmentMappingView {
  const resolved = assertMappedAppointmentDependencies(
    mapper,
    appointment.organizationId,
    appointment,
  );
  return {
    organizationAppId: appointment.organizationId,
    organizationDbId: resolved.organizationDbId,
    locationAppId: appointment.locationId,
    locationDbId: resolved.locationDbId,
    customerAppId: appointment.customerId,
    customerDbId: resolved.customerDbId,
    serviceAppId: appointment.serviceId,
    serviceDbId: resolved.serviceDbId,
    staffAppId: mapper.requireOperationalStaffId(
      appointment.organizationId,
      appointment.staffId,
    ),
  };
}

export async function createFirstRemoteQaAppointment(
  adapter: AppointmentRemoteAdapter,
  mapper: CanonicalIdMapper,
): Promise<ExistingOrCreatedAppointment> {
  const existing = await findExactQaAppointment(adapter);
  if (existing) {
    return {
      status: "existing",
      appointment: existing,
      mapping: mappingFor(mapper, existing),
    };
  }
  const created = await createAppointmentRecord(
    BOOTSTRAP_TARGET.organizationAppId,
    { ...FIRST_REMOTE_APPOINTMENT_PAYLOAD },
    { appointments: adapter },
  );
  return {
    status: "created",
    appointment: created,
    mapping: mappingFor(mapper, created),
  };
}

export async function loadAppointmentBootstrapContext(
  client: AppointmentBootstrapClient,
): Promise<{
  identity: BootstrapIdentityView;
  rls: BootstrapRlsCheck;
  rlsPassed: boolean;
  mapping: AppointmentMappingView;
  mappingPassed: boolean;
  timeSafe: boolean;
  adapter: AppointmentRemoteAdapter;
  mapper: CanonicalIdMapper;
}> {
  const session = await client.auth.getUser();
  if (session.error || !session.data.user) {
    throw new Error("unauthenticated");
  }
  const loaded = await loadAuthenticatedIdentityCatalog(client);
  const location = loaded.catalog.findLocationByAppId(
    loaded.organizationDbId,
    BOOTSTRAP_TARGET.locationAppId,
  );
  if (
    loaded.organizationAppId !== BOOTSTRAP_TARGET.organizationAppId ||
    loaded.organizationDbId !== BOOTSTRAP_TARGET.organizationDbId ||
    loaded.operationalStaffId !== BOOTSTRAP_TARGET.operationalStaffId ||
    isAuthUuid(loaded.operationalStaffId) ||
    !location ||
    location.appId !== BOOTSTRAP_TARGET.locationAppId ||
    location.dbId !== BOOTSTRAP_TARGET.locationDbId
  ) {
    throw new Error("Authenticated identity does not match THE ENJOYE Owner target");
  }
  const mapping = resolveQaAppointmentMapping(loaded.mapper);
  const rls = await runAuthenticatedOwnerRlsPrecheck(client);
  const adapter = createExplicitAuthenticatedAppointmentAdapter(client, loaded.mapper);
  return {
    identity: {
      authenticated: true,
      operationalStaffId: loaded.operationalStaffId,
      role: BOOTSTRAP_TARGET.role,
      organizationAppId: loaded.organizationAppId,
      locationAppId: location.appId,
    },
    rls,
    rlsPassed: rlsPrecheckPassed(rls),
    mapping,
    mappingPassed: mappingPrecheckPassed(mapping),
    timeSafe: qaAppointmentTimeIsSafe(),
    adapter,
    mapper: loaded.mapper,
  };
}

export function isPreviewOnlyBootstrapAllowed(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv !== "production";
}

export { APPOINTMENT_STAFF_OVERLAP_MESSAGE };
