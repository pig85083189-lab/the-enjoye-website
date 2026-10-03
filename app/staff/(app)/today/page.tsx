import { TodayDashboard } from "@/features/today/TodayDashboard";
import { isTodayRemoteReadPilotEnabled } from "@/lib/appointments/today-remote-read-flag";

export default function TodayPage() {
  return <TodayDashboard todayRemoteReadPilot={isTodayRemoteReadPilotEnabled()} />;
}
