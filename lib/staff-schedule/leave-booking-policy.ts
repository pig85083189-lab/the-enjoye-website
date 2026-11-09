import type { TimeOffStatus } from "./domain";

/** Pending requests reserve the slot until the manager makes a decision. */
export function blocksMemberBookingForLeave(status: TimeOffStatus): boolean {
  return status === "REQUESTED" || status === "APPROVED";
}
