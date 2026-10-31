import { checkBookingSlot, type SlotCheckInput } from "./server-slot-evaluator";

const base: SlotCheckInput = {
  date: "2026-11-02",
  startTime: "10:00",
  durationMinutes: 60,
  staffVerified: true,
  locationVerified: true,
  serviceVerified: true,
  scheduleSnapshotComplete: true,
  workingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "21:00", isWorking: true }],
  breaks: [],
  approvedTimeOff: [],
  occupiedAppointments: [],
};

function assert(reason: string, input: SlotCheckInput, expected: string) {
  const result = checkBookingSlot(input);
  const actual = result.available ? "AVAILABLE" : result.reason;
  if (actual !== expected) throw new Error(reason + ": expected " + expected + ", got " + actual);
}

export function runSlotEvaluatorChecks() {
  assert("normal slot", base, "AVAILABLE");
  assert("unverified staff", { ...base, staffVerified: false }, "NOT_VERIFIED");
  assert("incomplete schedule feed", { ...base, scheduleSnapshotComplete: false }, "MISSING_SCHEDULE");
  assert("ambiguous working hours", { ...base, workingHours: [...base.workingHours!, ...base.workingHours!] }, "INVALID_INPUT");
  assert("missing hours", { ...base, workingHours: null }, "MISSING_SCHEDULE");
  assert("outside hours", { ...base, startTime: "08:30" }, "OUTSIDE_HOURS");
  assert("end outside hours", { ...base, startTime: "20:30" }, "OUTSIDE_HOURS");
  assert("break overlap", { ...base, breaks: [{ startsAt: "2026-11-02T10:30:00+08:00", endsAt: "2026-11-02T11:30:00+08:00" }] }, "BREAK");
  assert("approved leave", { ...base, approvedTimeOff: [{ startsAt: "2026-11-02T09:00:00+08:00", endsAt: "2026-11-02T12:00:00+08:00" }] }, "TIME_OFF");
  assert("booking overlap", { ...base, occupiedAppointments: [{ startsAt: "2026-11-02T09:30:00+08:00", endsAt: "2026-11-02T10:30:00+08:00" }] }, "CONFLICT");
  assert("adjacent booking allowed", { ...base, occupiedAppointments: [{ startsAt: "2026-11-02T09:00:00+08:00", endsAt: "2026-11-02T10:00:00+08:00" }] }, "AVAILABLE");
  assert("invalid date", { ...base, date: "2026-02-30" }, "INVALID_INPUT");
  assert("sunday closed", { ...base, date: "2026-11-01" }, "OUTSIDE_HOURS");
  assert("missing appointment feed", { ...base, occupiedAppointments: null }, "MISSING_SCHEDULE");
}
