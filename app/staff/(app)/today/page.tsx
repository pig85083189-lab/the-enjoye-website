import { connection } from "next/server";
import { TodayDashboard } from "@/features/today/TodayDashboard";
import { isTodayRemoteReadPilotEnabled } from "@/lib/appointments/today-remote-read-flag";
import { isCommerceRemoteReadPilotEnabled } from "@/lib/commerce/commerce-remote-read-flag";
import { isTreatmentRemoteReadPilotEnabled } from "@/lib/treatments/treatment-remote-read-flag";

export default async function TodayPage() {
  await connection();
  return (
    <TodayDashboard
      todayRemoteReadPilot={isTodayRemoteReadPilotEnabled()}
      treatmentRemoteReadPilot={isTreatmentRemoteReadPilotEnabled()}
      commerceRemoteReadPilot={isCommerceRemoteReadPilotEnabled()}
    />
  );
}
