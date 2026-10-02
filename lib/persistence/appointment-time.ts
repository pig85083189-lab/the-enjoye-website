/**
 * Explicit Asia/Taipei conversion for remote appointment timestamps.
 * Does not change browser-local helpers in lib/appointments/domain.ts.
 * Taiwan has no DST; offset is always UTC+8.
 */

export const APPOINTMENT_DISPLAY_TIMEZONE = "Asia/Taipei";
export const TAIPEI_OFFSET_MINUTES = 8 * 60;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseYmdHm(dateYmd: string, hm: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  const time = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!ymd || !time) {
    throw new Error(`Invalid Taipei local datetime ${JSON.stringify(dateYmd)} ${JSON.stringify(hm)}`);
  }
  return {
    y: Number(ymd[1]),
    m: Number(ymd[2]),
    d: Number(ymd[3]),
    hh: Number(time[1]),
    mm: Number(time[2]),
  };
}

/** 2026-10-02 10:00 Taiwan → 2026-10-02T02:00:00.000Z */
export function taipeiLocalToUtcIso(dateYmd: string, hm: string): string {
  const { y, m, d, hh, mm } = parseYmdHm(dateYmd, hm);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - TAIPEI_OFFSET_MINUTES * 60_000).toISOString();
}

export function utcIsoToTaipeiLocal(iso: string): { dateYmd: string; hm: string } {
  const utc = new Date(iso);
  if (Number.isNaN(utc.getTime())) {
    throw new Error(`Invalid timestamptz ${JSON.stringify(iso)}`);
  }
  const taipei = new Date(utc.getTime() + TAIPEI_OFFSET_MINUTES * 60_000);
  return {
    dateYmd: `${taipei.getUTCFullYear()}-${pad2(taipei.getUTCMonth() + 1)}-${pad2(taipei.getUTCDate())}`,
    hm: `${pad2(taipei.getUTCHours())}:${pad2(taipei.getUTCMinutes())}`,
  };
}

export function addMinutesToIso(iso: string, minutes: number): string {
  const utc = new Date(iso);
  if (Number.isNaN(utc.getTime()) || !Number.isInteger(minutes)) {
    throw new Error("Invalid ISO timestamp or minutes");
  }
  return new Date(utc.getTime() + minutes * 60_000).toISOString();
}

/** Customer 360 Appointment pilot display: Taipei date + start–end, never server-local. */
export function formatTaipeiAppointmentDisplay(
  startAt: string,
  endAt: string,
): { date: string; time: string } {
  const start = utcIsoToTaipeiLocal(startAt);
  const end = utcIsoToTaipeiLocal(endAt);
  const [year, month, day] = start.dateYmd.split("-");
  return {
    date: `${year}/${month}/${day}`,
    time: `${start.hm}–${end.hm}`,
  };
}
