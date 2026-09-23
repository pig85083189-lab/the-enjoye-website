import type { StaffMembership } from "@/types/saas";

/**
 * Phase 4.8B capability adapter.
 * Future: permission `canReceiveAppointments` / StaffServiceCapability matrix.
 * Prototype: any active membership may appear on the calendar.
 */
export function canReceiveAppointments(membership: StaffMembership): boolean {
  return membership.isActive;
}

/**
 * Future StaffServiceCapability — currently all bookable staff can run all services.
 */
export function staffCanPerformService(
  organizationId: string,
  staffId: string,
  serviceId: string,
): boolean {
  void organizationId;
  void staffId;
  void serviceId;
  return true;
}
