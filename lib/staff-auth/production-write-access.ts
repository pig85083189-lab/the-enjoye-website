import { canCreateAppointment, canWriteTreatment } from "@/lib/staff-auth/operational-capabilities";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";

/**
 * A membership with an empty auth_user_id is still a valid operational staff-*
 * identity. It cannot start a Supabase Auth session until that column is bound.
 * Appointment and treatment writes are performed by the signed-in actor, who
 * must have a bound session and an operational role.
 */
export interface ProductionStaffAccess {
  operationalIdentityValid: boolean;
  authenticatedSessionBound: boolean;
  canBeAppointmentStaff: boolean;
  canWriteAppointments: boolean;
  canWriteTreatments: boolean;
}

export function classifyProductionStaffAccess(row: {
  userId: string;
  authUserId: string | null;
  role: string;
  isActive: boolean;
}): ProductionStaffAccess {
  const userId = row.userId.trim();
  const operationalIdentityValid = row.isActive && userId.length > 0 && !isAuthUuid(userId);
  const authenticatedSessionBound = operationalIdentityValid && Boolean(row.authUserId?.trim());
  const actor = { role: row.role, isActive: row.isActive };
  return {
    operationalIdentityValid,
    authenticatedSessionBound,
    canBeAppointmentStaff: operationalIdentityValid,
    canWriteAppointments: authenticatedSessionBound && canCreateAppointment(actor),
    canWriteTreatments: authenticatedSessionBound && canWriteTreatment(actor),
  };
}
