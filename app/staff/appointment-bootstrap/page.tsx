import { AppointmentBootstrapClient } from "./AppointmentBootstrapClient";
import { isPreviewOnlyBootstrapAllowed } from "@/lib/staff-auth/appointment-bootstrap";

export const dynamic = "force-dynamic";

export default function AppointmentBootstrapPage() {
  if (!isPreviewOnlyBootstrapAllowed(process.env.VERCEL_ENV)) {
    return (
      <main className="mx-auto max-w-xl px-6 py-10 text-[15px] leading-relaxed text-text">
        <h1 className="text-xl font-semibold">Appointment bootstrap unavailable</h1>
        <p className="mt-2 text-sm text-secondary-text">
          Preview-only route. Production has no create capability.
        </p>
      </main>
    );
  }
  return <AppointmentBootstrapClient />;
}
