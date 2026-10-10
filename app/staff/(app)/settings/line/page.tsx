import { connection } from "next/server";
import { LineOfficialAccountSettings } from "@/features/line/LineOfficialAccountSettings";
import { isLineConnectionPilotEnabled } from "@/lib/line/line-flag";
import { StaffRolePageLayout } from "@/lib/staff/StaffRolePageLayout";
import { STAFF_LINE_ROLES } from "@/lib/staff/staff-role-page-access";

export default async function LineOfficialAccountSettingsRoute() {
  await connection();
  return (
    <StaffRolePageLayout allowedRoles={STAFF_LINE_ROLES}>
      <LineOfficialAccountSettings
        connectionPilotEnabled={isLineConnectionPilotEnabled()}
      />
    </StaffRolePageLayout>
  );
}
