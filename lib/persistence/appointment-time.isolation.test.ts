import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_DISPLAY_TIMEZONE,
  addMinutesToIso,
  formatTaipeiAppointmentDisplay,
  taipeiLocalToUtcIso,
  utcIsoToTaipeiLocal,
} from "./appointment-time";

describe("Phase 1C-5A Taipei appointment time mapping", () => {
  it("maps 2026-10-02 10:00 Taiwan to 02:00Z and not 10:00Z or 18:00Z", () => {
    const iso = taipeiLocalToUtcIso("2026-10-02", "10:00");
    expect(APPOINTMENT_DISPLAY_TIMEZONE).toBe("Asia/Taipei");
    expect(iso).toBe("2026-10-02T02:00:00.000Z");
    expect(iso).not.toBe("2026-10-02T10:00:00.000Z");
    expect(iso).not.toBe("2026-10-02T18:00:00.000Z");
    expect(utcIsoToTaipeiLocal(iso)).toEqual({ dateYmd: "2026-10-02", hm: "10:00" });
    expect(utcIsoToTaipeiLocal("2026-10-02T10:00:00.000Z")).toEqual({
      dateYmd: "2026-10-02",
      hm: "18:00",
    });
  });

  it("derives endAt from duration without shifting the calendar day", () => {
    const startAt = taipeiLocalToUtcIso("2026-10-09", "10:00");
    const endAt = addMinutesToIso(startAt, 100);
    expect(startAt).toBe("2026-10-09T02:00:00.000Z");
    expect(endAt).toBe("2026-10-09T03:40:00.000Z");
    expect(utcIsoToTaipeiLocal(endAt)).toEqual({ dateYmd: "2026-10-09", hm: "11:40" });
    expect(formatTaipeiAppointmentDisplay(startAt, endAt)).toEqual({
      date: "2026/10/09",
      time: "10:00–11:40",
    });
    expect(formatTaipeiAppointmentDisplay(startAt, endAt).time).not.toMatch(/02:00|03:40/);
  });
});
