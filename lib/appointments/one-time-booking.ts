/** One-time staff booking input: never creates or resolves a customer record. */

export const BOOKING_ORIGIN_CUSTOMER = "CUSTOMER" as const;
export const BOOKING_ORIGIN_WALK_IN_ONCE = "WALK_IN_ONCE" as const;

export type BookingOrigin =
  | typeof BOOKING_ORIGIN_CUSTOMER
  | typeof BOOKING_ORIGIN_WALK_IN_ONCE;

export type OneTimeBookingInput = {
  guestName: string;
  guestPhone: string;
  serviceId: string;
  staffId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
};

const GUEST_PHONE_PATTERN = /^\+?[0-9() -]{8,24}$/;

export function validateOneTimeBooking(input: OneTimeBookingInput): string | null {
  if (!input.guestName.trim() || input.guestName.trim().length > 80) {
    return "請填寫客人姓名（80 字以內）";
  }
  if (!GUEST_PHONE_PATTERN.test(input.guestPhone.trim())) {
    return "請填寫有效聯絡電話";
  }
  if (![input.serviceId, input.staffId, input.locationId].every(Boolean)) {
    return "請選擇服務、美容師與分店";
  }
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "預約時間無效";
  }
  return null;
}

export function oneTimeBookingPayload(input: OneTimeBookingInput) {
  const error = validateOneTimeBooking(input);
  if (error) throw new Error(error);
  return {
    booking_origin: BOOKING_ORIGIN_WALK_IN_ONCE,
    customer_id: null,
    customer_name_snapshot: input.guestName.trim(),
    guest_contact_phone: input.guestPhone.trim(),
    service_id: input.serviceId,
    staff_id: input.staffId,
    location_id: input.locationId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  };
}

export function isWalkInOnceOrigin(origin: string | null | undefined): boolean {
  return origin === BOOKING_ORIGIN_WALK_IN_ONCE;
}
