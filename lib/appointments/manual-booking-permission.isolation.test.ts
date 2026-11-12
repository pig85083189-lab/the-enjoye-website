import { describe, expect, it } from "vitest";
import { canCreateAppointment } from "@/lib/staff-auth/operational-capabilities";
import { createAppointmentWriteSnapshotCatalog } from "./appointment-write-snapshots";
import { resolveCalendarCreateSurface } from "./appointment-write-surface";
import { isAppointmentRemoteWritePilotEnabled } from "./appointment-remote-write-flag";

describe("manual booking permission and remote-write safety", () => {
  it("allows owner, manager, staff and receptionist but denies accountant/inactive", () => {
    for (const role of ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]) {
      expect(canCreateAppointment({role,isActive:true})).toBe(true);
    }
    expect(canCreateAppointment({role:"ACCOUNTANT",isActive:true})).toBe(false);
    expect(canCreateAppointment({role:"STAFF",isActive:false})).toBe(false);
  });
  it("keeps remote-read calendars create-disabled until write is explicitly enabled", () => {
    expect(resolveCalendarCreateSurface({calendarRemoteReadPilot:true,appointmentRemoteWritePilot:false,canCreateAppointment:true}).createEnabled).toBe(false);
    expect(resolveCalendarCreateSurface({calendarRemoteReadPilot:true,appointmentRemoteWritePilot:true,canCreateAppointment:true}).remoteCreate).toBe(true);
    expect(resolveCalendarCreateSurface({calendarRemoteReadPilot:true,appointmentRemoteWritePilot:true,canCreateAppointment:false}).createEnabled).toBe(false);
  });
  it("requires both read and write flags", () => {
    expect(isAppointmentRemoteWritePilotEnabled({BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT:"1"})).toBe(false);
    expect(isAppointmentRemoteWritePilotEnabled({BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT:"1",BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT:"1"})).toBe(true);
  });
  it("resolves UUID-only member customers and preserves legacy IDs", () => {
    const catalog=createAppointmentWriteSnapshotCatalog({customers:[
      {organizationId:"org-1",appId:"e06709d5-893f-4be1-8d83-b3d666a9257c",name:"會員顧客"},
      {organizationId:"org-1",appId:"cust-123",name:"舊顧客"},
    ],services:[],staff:[]});
    expect(catalog.customerName("org-1","e06709d5-893f-4be1-8d83-b3d666a9257c")).toBe("會員顧客");
    expect(catalog.customerName("org-1","cust-123")).toBe("舊顧客");
    expect(()=>catalog.customerName("org-2","cust-123")).toThrow();
  });
});
