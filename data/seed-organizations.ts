import type {
  Location,
  Organization,
  OrganizationSubscription,
  StaffMembership,
} from "@/types/saas";
import type { Appointment, Customer, Service, Staff } from "@/types";
import type {
  CrmAppointment,
  CustomerConsultation,
  CustomerNote,
} from "@/types/customer";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_ENJOYE_SECONDARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_ENJOYE_STAFF_AMY_ID,
  MEMBERSHIP_ENJOYE_STAFF_ANAN_ID,
  MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  MEMBERSHIP_LUMIERE_THERAPIST_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { PRESET_CUSTOMER_TAGS } from "@/types/customer";

const now = "2026-09-20T00:00:00+08:00";

export const SEED_ORGANIZATIONS: Organization[] = [
  {
    id: ORG_ENJOYE_ID,
    name: "THE ENJOYE",
    slug: "the-enjoye",
    logoUrl: null,
    phone: "04-1234-5678",
    email: "hello@theenjoye.example",
    address: "台中市西屯區示範路 88 號",
    timezone: "Asia/Taipei",
    currency: "TWD",
    locale: "zh-TW",
    status: "ACTIVE",
    createdAt: "2025-01-01T00:00:00+08:00",
    updatedAt: now,
  },
  {
    id: ORG_LUMIERE_ID,
    name: "LUMIÈRE BEAUTY",
    slug: "lumiere-beauty",
    logoUrl: null,
    phone: "02-8765-4321",
    email: "hi@lumiere.example",
    address: "台北市大安區光復南路 12 號",
    timezone: "Asia/Taipei",
    currency: "TWD",
    locale: "zh-TW",
    status: "TRIAL",
    createdAt: "2026-08-01T00:00:00+08:00",
    updatedAt: now,
  },
];

export const SEED_LOCATIONS: Location[] = [
  {
    id: LOC_ENJOYE_PRIMARY_ID,
    organizationId: ORG_ENJOYE_ID,
    name: "THE ENJOYE 主店",
    code: "TC-MAIN",
    phone: "04-1234-5678",
    address: "台中市西屯區示範路 88 號",
    timezone: "Asia/Taipei",
    isPrimary: true,
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
    updatedAt: now,
  },
  {
    id: LOC_ENJOYE_SECONDARY_ID,
    organizationId: ORG_ENJOYE_ID,
    name: "THE ENJOYE 公益店",
    code: "TC-GONGYI",
    phone: "04-2222-3333",
    address: "台中市西區公益路 100 號",
    timezone: "Asia/Taipei",
    isPrimary: false,
    isActive: true,
    createdAt: "2025-06-01T00:00:00+08:00",
    updatedAt: now,
  },
  {
    id: LOC_LUMIERE_PRIMARY_ID,
    organizationId: ORG_LUMIERE_ID,
    name: "LUMIÈRE 大安店",
    code: "TPE-DAAN",
    phone: "02-8765-4321",
    address: "台北市大安區光復南路 12 號",
    timezone: "Asia/Taipei",
    isPrimary: true,
    isActive: true,
    createdAt: "2026-08-01T00:00:00+08:00",
    updatedAt: now,
  },
];

const ENJOYE_LOCATION_IDS = [LOC_ENJOYE_PRIMARY_ID, LOC_ENJOYE_SECONDARY_ID];

export const SEED_MEMBERSHIPS: StaffMembership[] = [
  {
    id: MEMBERSHIP_ENJOYE_OWNER_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    locationIds: ENJOYE_LOCATION_IDS,
    role: "OWNER",
    displayName: "怡蓁",
    isActive: true,
    createdAt: "2025-01-01T00:00:00+08:00",
  },
  {
    id: MEMBERSHIP_ENJOYE_STAFF_XIAOMEI_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-002",
    locationIds: ENJOYE_LOCATION_IDS,
    role: "STAFF",
    displayName: "小美",
    isActive: true,
    createdAt: "2025-03-01T00:00:00+08:00",
  },
  {
    id: MEMBERSHIP_ENJOYE_STAFF_AMY_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-003",
    locationIds: ENJOYE_LOCATION_IDS,
    role: "STAFF",
    displayName: "Amy",
    isActive: true,
    createdAt: "2025-04-01T00:00:00+08:00",
  },
  {
    id: MEMBERSHIP_ENJOYE_STAFF_ANAN_ID,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-004",
    locationIds: ENJOYE_LOCATION_IDS,
    role: "STAFF",
    displayName: "安安",
    isActive: true,
    createdAt: "2025-05-01T00:00:00+08:00",
  },
  {
    id: MEMBERSHIP_LUMIERE_STAFF_ID,
    organizationId: ORG_LUMIERE_ID,
    userId: "staff-001",
    locationIds: [LOC_LUMIERE_PRIMARY_ID],
    role: "STAFF",
    displayName: "怡蓁",
    isActive: true,
    createdAt: "2026-08-01T00:00:00+08:00",
  },
  {
    id: MEMBERSHIP_LUMIERE_THERAPIST_ID,
    organizationId: ORG_LUMIERE_ID,
    userId: "staff-lumiere-01",
    locationIds: [LOC_LUMIERE_PRIMARY_ID],
    role: "STAFF",
    displayName: "語柔",
    isActive: true,
    createdAt: "2026-08-01T00:00:00+08:00",
  },
];

export const SEED_SUBSCRIPTIONS: OrganizationSubscription[] = [
  {
    organizationId: ORG_ENJOYE_ID,
    planId: "BUSINESS",
    status: "ACTIVE",
    trialEndsAt: null,
    currentPeriodEndsAt: "2026-12-31T23:59:59+08:00",
  },
  {
    organizationId: ORG_LUMIERE_ID,
    planId: "FREE_TRIAL",
    status: "TRIALING",
    trialEndsAt: "2026-10-01T23:59:59+08:00",
    currentPeriodEndsAt: null,
  },
];

const tag = (id: keyof typeof PRESET_CUSTOMER_TAGS) => PRESET_CUSTOMER_TAGS[id];

/** Small isolated demo set for LUMIÈRE BEAUTY */
export const SEED_LUMIERE_CUSTOMERS: Customer[] = [
  {
    id: "lumiere-c-001",
    organizationId: ORG_LUMIERE_ID,
    name: "周雨萱",
    phone: "0988-111-222",
    birthday: "1994/07/08",
    age: 32,
    membership: "vip",
    lastVisit: "2026/09/15",
    totalVisits: 6,
    packages: [],
    lastServiceNotes: ["臉部保養為主"],
    trackingFocus: ["兩頰乾燥"],
    alerts: [],
    tags: [tag("vip"), tag("facial")],
    primaryStaffId: "staff-lumiere-01",
    primaryStaffName: "語柔",
    joinedAt: "2026/02/10",
    nextAppointmentLabel: "2026/09/22 15:00",
    nextAppointmentAt: "2026-09-22T15:00:00+08:00",
    lastServiceName: "臉部保養",
    importantNotes: ["偏好清爽質地"],
    listStatus: "normal",
    preferences: {
      preferredStaffName: "語柔",
      pressure: "light",
      chatPreference: "quiet",
      temperature: "normal",
    },
    createdAt: "2026-02-10T10:00:00+08:00",
    updatedAt: "2026-09-15T16:00:00+08:00",
  },
  {
    id: "lumiere-c-002",
    organizationId: ORG_LUMIERE_ID,
    name: "蘇子晴",
    phone: "0977-333-444",
    birthday: "1998/11/02",
    age: 27,
    membership: "new",
    lastVisit: "2026/09/19",
    totalVisits: 1,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [tag("new")],
    primaryStaffId: "staff-lumiere-01",
    primaryStaffName: "語柔",
    joinedAt: "2026/09/19",
    nextAppointmentLabel: null,
    nextAppointmentAt: null,
    lastServiceName: "臉部保養",
    listStatus: "normal",
    createdAt: "2026-09-19T11:00:00+08:00",
    updatedAt: "2026-09-19T12:30:00+08:00",
  },
  {
    id: "lumiere-c-003",
    organizationId: ORG_LUMIERE_ID,
    name: "何佩君",
    phone: "0966-555-666",
    birthday: "1990/04/21",
    age: 36,
    membership: "regular",
    lastVisit: "2026/08/28",
    totalVisits: 4,
    packages: [],
    lastServiceNotes: ["需追蹤肩頸"],
    trackingFocus: ["肩頸緊繃"],
    alerts: [],
    tags: [tag("regular"), tag("needs_follow_up")],
    primaryStaffId: "staff-lumiere-01",
    primaryStaffName: "語柔",
    joinedAt: "2026/05/01",
    nextAppointmentLabel: null,
    nextAppointmentAt: null,
    lastServiceName: "肩頸放鬆",
    importantNotes: ["容易緊張"],
    listStatus: "needs_follow_up",
    createdAt: "2026-05-01T09:00:00+08:00",
    updatedAt: "2026-08-28T17:00:00+08:00",
  },
];

export const SEED_LUMIERE_STAFF: Staff[] = [
  {
    id: "staff-lumiere-01",
    username: "yurou",
    password: "demo1234",
    name: "語柔",
    displayName: "語柔",
    avatarInitials: "語",
    title: "美容師",
  },
];

export const SEED_LUMIERE_SERVICES: Service[] = [
  {
    id: "svc-lumiere-facial",
    organizationId: ORG_LUMIERE_ID,
    name: "光感臉部保養",
    durationMinutes: 90,
    category: "facial",
    serviceType: "FACIAL",
    priceMinor: 3000,
  },
  {
    id: "svc-lumiere-relax",
    organizationId: ORG_LUMIERE_ID,
    name: "肩頸放鬆",
    durationMinutes: 60,
    category: "body",
    serviceType: "BODY_SCULPTING",
    priceMinor: 2200,
  },
];

export const SEED_LUMIERE_APPOINTMENTS: Appointment[] = [
  {
    id: "lumiere-apt-001",
    organizationId: ORG_LUMIERE_ID,
    locationId: LOC_LUMIERE_PRIMARY_ID,
    time: "15:00",
    customerId: "lumiere-c-001",
    customerName: "周雨萱",
    serviceId: "svc-lumiere-facial",
    serviceName: "光感臉部保養",
    durationMinutes: 90,
    membership: "vip",
    staffId: "staff-lumiere-01",
    staffName: "語柔",
    status: "pending",
    notes: ["偏好清爽質地"],
  },
  {
    id: "lumiere-apt-002",
    organizationId: ORG_LUMIERE_ID,
    locationId: LOC_LUMIERE_PRIMARY_ID,
    time: "11:00",
    customerId: "lumiere-c-002",
    customerName: "蘇子晴",
    serviceId: "svc-lumiere-facial",
    serviceName: "光感臉部保養",
    durationMinutes: 90,
    membership: "new",
    staffId: "staff-lumiere-01",
    staffName: "語柔",
    status: "completed",
    notes: [],
  },
];

export const SEED_LUMIERE_NOTES: CustomerNote[] = [
  {
    id: "lumiere-note-001",
    organizationId: ORG_LUMIERE_ID,
    customerId: "lumiere-c-001",
    content: "VIP 客，喜歡安靜休息空間。",
    pinned: true,
    authorId: "staff-lumiere-01",
    authorName: "語柔",
    createdAt: "2026-09-15T16:30:00+08:00",
    updatedAt: "2026-09-15T16:30:00+08:00",
  },
];

export const SEED_LUMIERE_CONSULTATIONS: CustomerConsultation[] = [
  {
    id: "lumiere-consult-001",
    organizationId: ORG_LUMIERE_ID,
    customerId: "lumiere-c-002",
    kind: "initial",
    title: "初次諮詢",
    goals: ["skin", "relax"],
    healthItems: [],
    customerConfirmed: true,
    signatureText: "蘇子晴",
    consultedAt: "2026-09-19T11:00:00+08:00",
    consultedBy: "staff-lumiere-01",
    consultedByName: "語柔",
    customerConfirmedAt: "2026-09-19T11:20:00+08:00",
    createdAt: "2026-09-19T11:00:00+08:00",
    updatedAt: "2026-09-19T11:20:00+08:00",
  },
];

export const SEED_LUMIERE_CRM_APPOINTMENTS: CrmAppointment[] = [
  {
    id: "lumiere-apt-001",
    organizationId: ORG_LUMIERE_ID,
    locationId: LOC_LUMIERE_PRIMARY_ID,
    customerId: "lumiere-c-001",
    customerName: "周雨萱",
    serviceId: "svc-lumiere-facial",
    serviceName: "光感臉部保養",
    staffId: "staff-lumiere-01",
    staffName: "語柔",
    startsAt: "2026-09-22T15:00:00+08:00",
    status: "booked",
    durationMinutes: 90,
    membership: "vip",
  },
  {
    id: "lumiere-apt-002",
    organizationId: ORG_LUMIERE_ID,
    locationId: LOC_LUMIERE_PRIMARY_ID,
    customerId: "lumiere-c-002",
    customerName: "蘇子晴",
    serviceId: "svc-lumiere-facial",
    serviceName: "光感臉部保養",
    staffId: "staff-lumiere-01",
    staffName: "語柔",
    startsAt: "2026-09-19T11:00:00+08:00",
    status: "completed",
    durationMinutes: 90,
    membership: "new",
  },
];

export function getSeedOrganization(id: string): Organization | undefined {
  return SEED_ORGANIZATIONS.find((o) => o.id === id);
}

export function getSeedLocations(organizationId: string): Location[] {
  return SEED_LOCATIONS.filter((l) => l.organizationId === organizationId);
}

export function getSeedMembership(
  organizationId: string,
  userId: string,
): StaffMembership | undefined {
  return SEED_MEMBERSHIPS.find(
    (m) => m.organizationId === organizationId && m.userId === userId && m.isActive,
  );
}
