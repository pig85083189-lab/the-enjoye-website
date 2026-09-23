export type AppointmentStatus = "pending" | "in_progress" | "completed";

export type MembershipTier = "vip" | "regular" | "new";

export interface Staff {
  id: string;
  username: string;
  password: string;
  name: string;
  displayName: string;
  avatarInitials: string;
  title: string;
}

export interface Service {
  id: string;
  organizationId: string;
  name: string;
  durationMinutes: number;
  category: string;
  /** Template registry key — never derive from display name */
  serviceType: import("./treatment-template").TreatmentServiceType;
  /**
   * List price in integer minor units (TWD: NT$1 = 1).
   * Phase 4.9A commerce — optional for backward compatibility; adapter supplies fallback.
   */
  priceMinor?: number;
}

export interface CustomerPackage {
  id: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  /**
   * @deprecated Phase 4.9B+ — NOT canonical balance.
   * Use CustomerPackage + PackageLedger (`lib/packages`) / Wallet tab.
   * Seed CRM display residue only.
   */
  remainingSessions: number;
  totalSessions: number;
}

export interface CustomerAlert {
  id: string;
  customerId: string;
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "success";
}

export interface Customer {
  id: string;
  /** Tenant boundary — required for SaaS isolation */
  organizationId: string;
  name: string;
  phone: string;
  birthday: string;
  age: number;
  membership: MembershipTier;
  lastVisit: string;
  totalVisits: number;
  /**
   * @deprecated Phase 4.9B+ — NOT canonical package inventory.
   * Seed / CRM residue only. Canonical: CustomerPackage + PackageLedger (`lib/packages`).
   * Wallet / Checkout / Transaction must never treat this as balance SoT.
   */
  packages: CustomerPackage[];
  lastServiceNotes: string[];
  trackingFocus: string[];
  alerts: CustomerAlert[];
  /** Phase 4 CRM fields */
  tags: import("./customer").CustomerTag[];
  email?: string;
  lineId?: string;
  gender?: import("./customer").CustomerGender;
  occupation?: string;
  address?: string;
  source?: import("./customer").CustomerSource;
  primaryStaffId?: string;
  primaryStaffName?: string;
  joinedAt: string;
  nextAppointmentAt?: string | null;
  nextAppointmentLabel?: string | null;
  lastServiceName?: string;
  preferences?: import("./customer").CustomerPreference | null;
  importantNotes?: string[];
  listStatus?: import("./customer").CustomerListStatus;
  createdAt: string;
  updatedAt: string;
}

export type {
  CustomerSource,
  CustomerGender,
  CustomerListStatus,
  CustomerTag,
  CustomerPreference,
  ConsultationGoalId,
  ConsultationHealthItem,
  ConsultationFemaleCycle,
  ConsultationSpaHistory,
  ConsultationKind,
  CustomerConsultation,
  CustomerNote,
  CustomerPhoto,
  CustomerPhotoKind,
  CrmAppointment,
  CrmAppointmentStatus,
  PressurePreference,
  ChatPreference,
  TemperaturePreference,
  PresetCustomerTagId,
} from "./customer";

export interface Appointment {
  id: string;
  organizationId: string;
  locationId?: string;
  time: string;
  customerId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  membership: MembershipTier;
  remainingSessions?: number;
  staffId: string;
  staffName: string;
  status: AppointmentStatus;
  notes: string[];
}

export type {
  TreatmentStepId,
  TreatmentStatus,
  PhotoType,
  BodyAreaId,
  BodyCondition,
  TreatmentAssessment,
  BodyMarker,
  TreatmentOperation,
  TreatmentProduct,
  TreatmentPhoto,
  TreatmentPhotoMeta,
  TreatmentNote,
  TreatmentFollowUp,
  TreatmentDraft,
  AppointmentStatusMap,
} from "./treatment";

export { TREATMENT_STEPS, CLIENT_FEELINGS, SENSITIVITY_LEVELS, OPTIONAL_STEPS, isOptionalStep } from "./treatment";

export type {
  TreatmentServiceType,
  BodyMapType,
  TemplateBodyArea,
  TemplateOperationItem,
  TemplateOperationGroup,
  TemplateProduct,
  TreatmentTemplate,
  AssessmentComparison,
} from "./treatment-template";

export type {
  Organization,
  OrganizationStatus,
  Location,
  StaffMembership,
  StaffRole,
  PlanId,
  SubscriptionStatus,
  OrganizationSubscription,
  FeatureKey,
  OrgScoped,
  OrgEntityRef,
} from "./saas";
