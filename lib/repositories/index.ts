export type {
  CustomerRepository,
  ConsultationRepository,
  CustomerNoteRepository,
  CustomerPhotoRepository,
  AppointmentRepository,
  TreatmentRepository,
} from "./interfaces";

export { localCustomerRepository } from "./local-customer-repository";
export { localConsultationRepository } from "./local-consultation-repository";
export { localCustomerNoteRepository } from "./local-note-repository";
export { localCustomerPhotoRepository } from "./local-photo-repository";
export { localAppointmentRepository } from "./local-appointment-repository";
export { localTreatmentRepository } from "./local-treatment-repository";
export {
  loadConsultationDraft,
  saveConsultationDraft,
  clearConsultationDraft,
} from "./consultation-draft";
export { STORAGE_KEYS, consultationDraftKey, CRM_CHANGE_EVENT } from "./keys";
export { subscribeCrmStore } from "./storage";
export { useCrmJson, useIsClient } from "./use-crm-store";
