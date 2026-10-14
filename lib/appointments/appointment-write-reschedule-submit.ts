/**
 * Duplicate-submit guard for Calendar remote Reschedule.
 * Does not write localStorage or call local updateAppointment.
 */

export type AppointmentRescheduleSubmitPhase =
  | "idle"
  | "submitting"
  | "success"
  | "error";

export const APPOINTMENT_RESCHEDULE_SUBMIT_ALREADY_SUCCEEDED_MESSAGE =
  "Appointment reschedule already succeeded";

export class AppointmentRescheduleSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentRescheduleSubmitError";
  }
}

export function appointmentRescheduleDisabled(
  phase: AppointmentRescheduleSubmitPhase,
): boolean {
  return phase === "submitting" || phase === "success";
}

export class AppointmentRescheduleSubmission<T> {
  phase: AppointmentRescheduleSubmitPhase = "idle";
  error: Error | null = null;
  result: T | null = null;
  rescheduleRequests = 0;

  get disabled(): boolean {
    return appointmentRescheduleDisabled(this.phase);
  }

  async submit(run: () => Promise<T>): Promise<"ignored" | "success" | "error"> {
    if (this.phase === "success") {
      throw new AppointmentRescheduleSubmitError(
        APPOINTMENT_RESCHEDULE_SUBMIT_ALREADY_SUCCEEDED_MESSAGE,
      );
    }
    if (appointmentRescheduleDisabled(this.phase)) {
      return "ignored";
    }
    this.error = null;
    this.phase = "submitting";
    this.rescheduleRequests += 1;
    try {
      this.result = await run();
      this.phase = "success";
      return "success";
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.phase = "error";
      return "error";
    }
  }
}
