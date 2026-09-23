import type { OrgScoped } from "@/types/saas";
import type { Customer } from "@/types";
import type {
  CrmAppointment,
  CustomerConsultation,
  CustomerNote,
  CustomerPhoto,
} from "@/types/customer";
import type { TreatmentDraft } from "@/types/treatment";

export type OrgQuery = OrgScoped;

export type OrgEntityQuery = OrgScoped & {
  id: string;
};

export type OrgCustomerQuery = OrgScoped & {
  customerId: string;
};

export interface CustomerRepository {
  list(query: OrgQuery): Customer[];
  getById(query: OrgEntityQuery): Customer | undefined;
  upsert(customer: Customer): Customer;
  findByPhone(query: OrgQuery & { phone: string }): Customer[];
}

export interface ConsultationRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerConsultation[];
  getById(query: OrgEntityQuery): CustomerConsultation | undefined;
  create(consultation: CustomerConsultation): CustomerConsultation;
}

export interface CustomerNoteRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerNote[];
  create(
    note: Omit<CustomerNote, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): CustomerNote;
  update(note: CustomerNote): CustomerNote;
}

export interface CustomerPhotoRepository {
  listByCustomer(query: OrgCustomerQuery): CustomerPhoto[];
}

export interface AppointmentRepository {
  listByCustomer(query: OrgCustomerQuery): CrmAppointment[];
  getById(query: OrgEntityQuery): CrmAppointment | undefined;
}

export interface TreatmentRepository {
  listByCustomer(query: OrgCustomerQuery): TreatmentDraft[];
  getById(query: OrgEntityQuery): TreatmentDraft | undefined;
}
