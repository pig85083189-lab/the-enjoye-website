/**
 * Canonical operational Service catalog public API.
 * Mutations live in lib/services/store.ts (seed + overlay). This module stays
 * the import path used by Appointment / Treatment / Checkout / Package.
 */
export { mockServices, getSeedServicesForOrganization } from "./service-seed";
export {
  getServiceById,
  getServicesForOrganization,
  listServices,
  isServiceActive,
} from "@/lib/services/store";
