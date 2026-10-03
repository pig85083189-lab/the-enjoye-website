/**
 * Reusable create submission state for a future Calendar Save button.
 * Not wired to live Calendar in 1C-6B.1.
 */

export type AppointmentWriteSubmitPhase =
  | "idle"
  | "validating"
  | "submitting"
  | "verifying"
  | "success"
  | "error";

export const APPOINTMENT_WRITE_SUBMIT_IN_FLIGHT_MESSAGE =
  "Appointment create is already in progress";

export const APPOINTMENT_WRITE_SUBMIT_ALREADY_SUCCEEDED_MESSAGE =
  "Appointment create already succeeded";

export class AppointmentWriteSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentWriteSubmitError";
  }
}

export function appointmentWriteSaveDisabled(
  phase: AppointmentWriteSubmitPhase,
): boolean {
  return (
    phase === "validating" ||
    phase === "submitting" ||
    phase === "verifying" ||
    phase === "success"
  );
}

export class AppointmentCreateSubmission<T> {
  phase: AppointmentWriteSubmitPhase = "idle";
  error: Error | null = null;
  result: T | null = null;
  createRequests = 0;

  constructor(readonly appointmentId: string) {}

  get saveDisabled(): boolean {
    return appointmentWriteSaveDisabled(this.phase);
  }

  async submit(
    run: (appointmentId: string) => Promise<T>,
  ): Promise<"ignored" | "success" | "error"> {
    if (this.phase === "success") {
      throw new AppointmentWriteSubmitError(
        APPOINTMENT_WRITE_SUBMIT_ALREADY_SUCCEEDED_MESSAGE,
      );
    }
    if (appointmentWriteSaveDisabled(this.phase)) {
      return "ignored";
    }

    this.error = null;
    this.phase = "validating";
    this.phase = "submitting";
    this.createRequests += 1;
    try {
      this.phase = "verifying";
      this.result = await run(this.appointmentId);
      this.phase = "success";
      return "success";
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.phase = "error";
      return "error";
    }
  }
}
