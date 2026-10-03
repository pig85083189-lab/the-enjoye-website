import { AppointmentReadDiagnosticPage } from "@/features/appointments/AppointmentReadDiagnosticPage";
import { isAppointmentReadDiagnosticEnabled } from "@/lib/appointments/appointment-read-diagnostic-flag";

export const dynamic = "force-dynamic";

export default function AppointmentReadDiagnosticRoute() {
  if (!isAppointmentReadDiagnosticEnabled()) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-surface px-4 py-6">
        <p className="font-medium text-text">Unavailable</p>
        <p className="mt-2 text-sm text-secondary-text">
          Temporary Appointment remote-read diagnostic is Preview-only.
        </p>
      </div>
    );
  }
  return <AppointmentReadDiagnosticPage />;
}
