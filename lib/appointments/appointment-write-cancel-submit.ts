/**
 * Duplicate-submit guard for Calendar remote Cancel.
 * Does not write localStorage or call local transitionAppointmentStatus.
 */

export type AppointmentCancelSubmitPhase = "idle" | "submitting" | "success" | "error";

export const APPOINTMENT_CANCEL_SUBMIT_ALREADY_SUCCEEDED_MESSAGE =
  "Appointment cancel already succeeded";

export class AppointmentCancelSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentCancelSubmitError";
  }
}

export function appointmentCancelDisabled(phase: AppointmentCancelSubmitPhase): boolean {
  return phase === "submitting" || phase === "success";
}

export class AppointmentCancelSubmission<T> {
  phase: AppointmentCancelSubmitPhase = "idle";
  error: Error | null = null;
  result: T | null = null;
  cancelRequests = 0;

  get disabled(): boolean {
    return appointmentCancelDisabled(this.phase);
  }

  async submit(run: () => Promise<T>): Promise<"ignored" | "success" | "error"> {
    if (this.phase === "success") {
      throw new AppointmentCancelSubmitError(
        APPOINTMENT_CANCEL_SUBMIT_ALREADY_SUCCEEDED_MESSAGE,
      );
    }
    if (appointmentCancelDisabled(this.phase)) {
      return "ignored";
    }
    this.error = null;
    this.phase = "submitting";
    this.cancelRequests += 1;
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
