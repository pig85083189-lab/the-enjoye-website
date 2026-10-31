import { evaluateSlotFromRepository, type BookingScheduleRepository, type VerifiedScheduleSnapshot } from "./booking-schedule-repository";

const request = {
  organizationId: "org-test",
  locationId: "location-test",
  staffId: "staff-test",
  serviceId: "service-test",
  date: "2026-11-02",
  startTime: "10:00",
};

const complete: VerifiedScheduleSnapshot = {
  ...request,
  durationMinutes: 60,
  staffVerified: true,
  locationVerified: true,
  serviceVerified: true,
  complete: true,
  workingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true }],
  breaks: [],
  approvedTimeOff: [],
  occupiedAppointments: [],
};

function repository(snapshot: VerifiedScheduleSnapshot): BookingScheduleRepository {
  return { readVerifiedSnapshot: async () => snapshot };
}

async function expectReason(
  name: string,
  source: BookingScheduleRepository,
  expected: string,
) {
  const result = await evaluateSlotFromRepository(source, request);
  const actual = result.available ? "AVAILABLE" : result.reason;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}

/** Explicit test entrypoint; no database writes or external services. */
export async function runBookingScheduleRepositoryChecks() {
  await expectReason("valid authoritative snapshot", repository(complete), "AVAILABLE");
  await expectReason("incomplete snapshot", repository({ ...complete, complete: false }), "MISSING_SCHEDULE");
  await expectReason("wrong tenant", repository({ ...complete, organizationId: "another-org" }), "NOT_VERIFIED");
  await expectReason("wrong location", repository({ ...complete, locationId: "another-location" }), "NOT_VERIFIED");
  await expectReason("wrong staff", repository({ ...complete, staffId: "another-staff" }), "NOT_VERIFIED");
  await expectReason("wrong service", repository({ ...complete, serviceId: "another-service" }), "NOT_VERIFIED");
  await expectReason("wrong date", repository({ ...complete, date: "2026-11-03" }), "NOT_VERIFIED");
  await expectReason("missing breaks feed", repository({ ...complete, breaks: null }), "MISSING_SCHEDULE");
  await expectReason("missing leave feed", repository({ ...complete, approvedTimeOff: null }), "MISSING_SCHEDULE");
  await expectReason("missing appointments feed", repository({ ...complete, occupiedAppointments: null }), "MISSING_SCHEDULE");
  await expectReason("unverified staff", repository({ ...complete, staffVerified: false }), "NOT_VERIFIED");
  await expectReason("appointment overlap", repository({
    ...complete,
    occupiedAppointments: [{ startsAt: "2026-11-02T02:30:00Z", endsAt: "2026-11-02T03:30:00Z" }],
  }), "CONFLICT");
  await expectReason("repository failure", {
    readVerifiedSnapshot: async () => { throw new Error("database unavailable"); },
  }, "MISSING_SCHEDULE");
}
