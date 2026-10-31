import type { BookingScheduleRepository, VerifiedScheduleSnapshot } from "./booking-schedule-repository";

/** Minimal query interface; pass a server-only, privileged Supabase client. Never browser-side. */
type QueryResult<T> = { data: T[] | null; error: unknown };
type Db = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string | boolean): any;
    };
  };
};
type Row = Record<string, any>;

const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000;
function taiwanDayBounds(date: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
  const midnight = Date.parse(date + "T00:00:00+08:00");
  if (!Number.isFinite(midnight) || new Date(midnight + TAIWAN_OFFSET_MS).toISOString().slice(0, 10) !== date) throw new Error("invalid date");
  return { start: new Date(midnight).toISOString(), end: new Date(midnight + 86400000).toISOString() };
}
function hhmm(value: unknown): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::00(?:\.0+)?)?$/.test(value)) throw new Error("invalid working hours");
  return value.slice(0, 5);
}
function intervals(rows: Row[]) {
  return rows.map(row => ({ startsAt: String(row.starts_at), endsAt: String(row.ends_at) }));
}
async function read<T>(query: PromiseLike<QueryResult<T>>): Promise<T[]> {
  const result = await query;
  if (result.error || !result.data) throw new Error("incomplete schedule feed");
  return result.data;
}

/**
 * Preview adapter. Caller MUST validate member/tenant identity before calling this.
 * No writes, no fallback hours. Any query error fails closed.
 * Requires complete, authoritative schedules to be populated by Beauty OS.
 */
export function createSupabaseBookingScheduleRepository(db: Db): BookingScheduleRepository {
  return {
    async readVerifiedSnapshot(input): Promise<VerifiedScheduleSnapshot> {
      const { organizationId, locationId, staffId, serviceId, date } = input;
      const { start, end } = taiwanDayBounds(date);
      // Verify all identifiers within the same tenant, including staff's location assignment.
      const [services, locations, memberships, assignments] = await Promise.all([
        read<Row>(db.from("services").select("id,duration_minutes,is_active,organization_id").eq("id", serviceId).eq("organization_id", organizationId)),
        read<Row>(db.from("locations").select("id,is_active,organization_id").eq("id", locationId).eq("organization_id", organizationId)),
        read<Row>(db.from("staff_auth_memberships").select("id,user_id,is_active,organization_id").eq("user_id", staffId).eq("organization_id", organizationId)),
        read<Row>(db.from("staff_auth_membership_locations").select("membership_id,location_id").eq("location_id", locationId)),
      ]);
      const membership = memberships.length === 1 ? memberships[0] : null;
      const serviceVerified = services.length === 1 && services[0].is_active === true;
      const locationVerified = locations.length === 1 && locations[0].is_active === true;
      const staffVerified = !!membership && membership.is_active === true && assignments.some(a => a.membership_id === membership.id);
      const base: VerifiedScheduleSnapshot = {
        ...input, durationMinutes: serviceVerified ? Number(services[0].duration_minutes) : 0,
        staffVerified, locationVerified, serviceVerified, complete: false,
        workingHours: null, breaks: null, approvedTimeOff: null, occupiedAppointments: null,
      };
      if (!staffVerified || !serviceVerified || !locationVerified) return base;
      const [hours, breaks, timeOff, appointments] = await Promise.all([
        read<Row>(db.from("booking_staff_working_hours").select("day_of_week,is_working,start_time,end_time").eq("organization_id", organizationId).eq("location_id", locationId).eq("staff_id", staffId)),
        read<Row>(db.from("booking_staff_breaks").select("starts_at,ends_at").eq("organization_id", organizationId).eq("location_id", locationId).eq("staff_id", staffId).lt("starts_at", end).gt("ends_at", start)),
        read<Row>(db.from("booking_staff_time_off").select("starts_at,ends_at").eq("organization_id", organizationId).eq("location_id", locationId).eq("staff_id", staffId).eq("approval_status", "approved").lt("starts_at", end).gt("ends_at", start)),
        read<Row>(db.from("appointments").select("starts_at,ends_at,status").eq("organization_id", organizationId).eq("location_id", locationId).eq("staff_id", staffId).lt("starts_at", end).gt("ends_at", start)),
      ]);
      // The schedule is incomplete until all seven weekday rows are explicitly configured.
      const weekdays = new Set(hours.map(h => h.day_of_week));
      if (hours.length !== 7 || weekdays.size !== 7 || [...weekdays].some(d => !Number.isInteger(d) || d < 0 || d > 6)) return base;
      const activeStatuses = new Set(["scheduled", "confirmed", "checked_in", "in_progress"]);
      // Unknown appointment statuses are treated as occupied, never accidentally freed.
      const cancelledStatuses = new Set(["cancelled", "canceled", "no_show", "completed"]);
      return {
        ...base, complete: true,
        workingHours: hours.map(h => ({
          dayOfWeek: h.day_of_week, isWorking: h.is_working,
          startTime: h.is_working ? hhmm(h.start_time) : "00:00",
          endTime: h.is_working ? hhmm(h.end_time) : "00:00",
        })),
        breaks: intervals(breaks),
        approvedTimeOff: intervals(timeOff),
        occupiedAppointments: intervals(appointments.filter(a => activeStatuses.has(a.status) || !cancelledStatuses.has(a.status))),
      };
    },
  };
}
