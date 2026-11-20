import { connection } from "next/server";
import { AppointmentInventoryReport } from "@/features/appointments/AppointmentInventoryReport";
import {
  fetchAppointmentInventoryDirectory,
  type InventoryReadClient,
} from "@/lib/appointments/appointment-inventory-directory";
import type { InventoryIdentityDirectory } from "@/lib/appointments/local-appointment-inventory";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function readOnlyInventoryClient(client: Awaited<ReturnType<typeof createClient>>): InventoryReadClient {
  return {
    from(table) {
      return {
        select(columns) {
          return {
            async eq(column, value) {
              const result = await client.from(table).select(columns).eq(column, value);
              return {
                data: Array.isArray(result.data) ? result.data : null,
                error: result.error ? { message: result.error.message } : null,
              };
            },
          };
        },
      };
    },
  };
}

const EMPTY_DIRECTORY: InventoryIdentityDirectory = {
  remoteCheck: "unavailable",
  organizationAppId: "",
  locationAppIds: [],
  customerAppIds: [],
  serviceAppIds: [],
  staff: [],
  remoteAppointments: [],
};

export default async function AppointmentInventoryPage() {
  await connection();
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") {
    return (
      <article data-appointment-inventory="readonly">
        <h1 className="text-xl font-semibold text-text">本機預約盤點</h1>
        <p className="mt-2 text-sm text-secondary-text">需要已綁定的員工登入才能讀取正式資料。這頁不會寫入預約。</p>
      </article>
    );
  }

  let directory: InventoryIdentityDirectory = {
    ...EMPTY_DIRECTORY,
    organizationAppId: resolved.membership.organizationId,
  };
  try {
    const client = readOnlyInventoryClient(await createClient());
    const loaded = await fetchAppointmentInventoryDirectory(client, resolved.membership.organizationId);
    if (loaded.remoteCheck === "checked") directory = loaded;
  } catch {
    directory = {
      ...EMPTY_DIRECTORY,
      organizationAppId: resolved.membership.organizationId,
    };
  }

  return (
    <AppointmentInventoryReport
      organizationId={resolved.membership.organizationId}
      directory={directory}
      nowIso={new Date().toISOString()}
    />
  );
}
