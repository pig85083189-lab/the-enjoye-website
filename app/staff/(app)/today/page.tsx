import { TodayDashboard } from "@/features/today/TodayDashboard";
import { isTodayRemoteReadPilotEnabled } from "@/lib/appointments/today-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default function TodayPage() {
  return (
    <TodayDashboard
      todayRemoteReadPilot={isTodayRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
    />
  );
}
