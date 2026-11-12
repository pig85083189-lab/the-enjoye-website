import { describe, expect, it } from "vitest";
import {
  BOOKING_ORIGIN_WALK_IN_ONCE,
  oneTimeBookingPayload,
  validateOneTimeBooking,
} from "./one-time-booking";
import {
  isOneTimeWalkinBookingEnabled,
  ONE_TIME_WALKIN_BOOKING_ENV,
} from "./one-time-walkin-flag";

const valid = {
  guestName: "臨櫃客人",
  guestPhone: "0912345678",
  serviceId: "svc-1",
  staffId: "staff-1",
  locationId: "loc-1",
  startsAt: "2026-11-12T02:00:00.000Z",
  endsAt: "2026-11-12T03:00:00.000Z",
};

describe("one-time walk-in booking validation", () => {
  it("accepts a valid guest payload without a customer id", () => {
    expect(validateOneTimeBooking(valid)).toBeNull();
    expect(oneTimeBookingPayload(valid)).toEqual({
      booking_origin: BOOKING_ORIGIN_WALK_IN_ONCE,
      customer_id: null,
      customer_name_snapshot: "臨櫃客人",
      guest_contact_phone: "0912345678",
      service_id: "svc-1",
      staff_id: "staff-1",
      location_id: "loc-1",
      starts_at: valid.startsAt,
      ends_at: valid.endsAt,
    });
  });

  it("rejects blank name, invalid phone, and inverted time range", () => {
    expect(validateOneTimeBooking({ ...valid, guestName: "  " })).toMatch(/姓名/);
    expect(validateOneTimeBooking({ ...valid, guestPhone: "abc" })).toMatch(/電話/);
    expect(
      validateOneTimeBooking({
        ...valid,
        startsAt: valid.endsAt,
        endsAt: valid.startsAt,
      }),
    ).toMatch(/時間/);
  });

  it("keeps the walk-in flag fail-closed until write + walk-in envs are both 1", () => {
    expect(isOneTimeWalkinBookingEnabled({})).toBe(false);
    expect(
      isOneTimeWalkinBookingEnabled({
        [ONE_TIME_WALKIN_BOOKING_ENV]: "1",
        BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT: "1",
      }),
    ).toBe(false);
    expect(
      isOneTimeWalkinBookingEnabled({
        [ONE_TIME_WALKIN_BOOKING_ENV]: "1",
        BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT: "1",
        BEAUTY_OS_APPOINTMENT_REMOTE_WRITE_PILOT: "1",
      }),
    ).toBe(true);
  });
});
