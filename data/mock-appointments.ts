import type { Appointment } from "@/types";
import { ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID } from "@/lib/tenant/constants";
import { SEED_LUMIERE_APPOINTMENTS } from "@/data/seed-organizations";

export const mockAppointments: Appointment[] = [
  {
    id: "apt-001",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    time: "10:00",
    customerId: "demo-001",
    customerName: "王小美",
    serviceId: "svc-breast",
    serviceName: "性感美胸 SPA",
    durationMinutes: 100,
    membership: "vip",
    remainingSessions: 5,
    staffId: "staff-001",
    staffName: "怡蓁",
    status: "pending",
    notes: ["右側腋下較緊", "外擴需持續追蹤"],
  },
  {
    id: "apt-002",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    time: "11:30",
    customerId: "demo-002",
    customerName: "林雅婷",
    serviceId: "svc-facial",
    serviceName: "臉部保養 SPA",
    durationMinutes: 90,
    membership: "regular",
    staffId: "staff-001",
    staffName: "怡蓁",
    status: "completed",
    notes: [],
  },
  {
    id: "apt-003",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    time: "14:00",
    customerId: "demo-003",
    customerName: "陳欣怡",
    serviceId: "svc-curve",
    serviceName: "窈窕曲線 SPA",
    durationMinutes: 100,
    membership: "new",
    staffId: "staff-001",
    staffName: "怡蓁",
    status: "pending",
    notes: ["初次來店", "諮詢表已完成"],
  },
  {
    id: "apt-004",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    time: "16:00",
    customerId: "demo-004",
    customerName: "張庭瑜",
    serviceId: "svc-womb",
    serviceName: "暖宮 SPA",
    durationMinutes: 90,
    membership: "vip",
    remainingSessions: 2,
    staffId: "staff-001",
    staffName: "怡蓁",
    status: "pending",
    notes: ["上次有療程照片"],
  },
  {
    id: "apt-005",
    organizationId: ORG_ENJOYE_ID,
    locationId: LOC_ENJOYE_PRIMARY_ID,
    time: "18:00",
    customerId: "demo-005",
    customerName: "李心柔",
    serviceId: "svc-breast",
    serviceName: "性感美胸 SPA",
    durationMinutes: 100,
    membership: "regular",
    staffId: "staff-001",
    staffName: "怡蓁",
    status: "in_progress",
    notes: [],
  },
];

export function getAppointmentsForOrganization(organizationId: string): Appointment[] {
  if (organizationId === ORG_ENJOYE_ID) return mockAppointments;
  return SEED_LUMIERE_APPOINTMENTS.filter((a) => a.organizationId === organizationId);
}

export function getTodayAppointmentStats(appointments: Appointment[]) {
  return {
    total: appointments.length,
    pending: appointments.filter((item) => item.status === "pending").length,
    inProgress: appointments.filter((item) => item.status === "in_progress").length,
    completed: appointments.filter((item) => item.status === "completed").length,
  };
}
