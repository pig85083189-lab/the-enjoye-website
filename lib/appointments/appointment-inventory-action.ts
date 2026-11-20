"use server";

import {
  fetchAppointmentInventoryDirectory,
  inventoryDirectoryForPage,
  type InventoryReadClient,
} from "@/lib/appointments/appointment-inventory-directory";
import {
  acceptInventoryAppointments,
  buildLocalAppointmentInventory,
  type LocalAppointmentInventoryReport,
} from "@/lib/appointments/local-appointment-inventory";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createClient } from "@/lib/supabase/server";

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

export async function loadAppointmentInventoryReport(input: {
  nowIso: string;
  localAppointments: readonly unknown[];
}): Promise<LocalAppointmentInventoryReport> {
  const resolved = await getAuthenticatedStaffMembership();
  if (resolved.status !== "ok") {
    return buildLocalAppointmentInventory({
      organizationId: "",
      now: new Date(input.nowIso),
      localAppointments: [],
      directory: inventoryDirectoryForPage(
        { remoteCheck: "unavailable", message: "需要已綁定的員工登入才能讀取正式資料" },
        "",
      ),
    });
  }

  const organizationId = resolved.membership.organizationId;
  const submitted = Array.isArray(input.localAppointments) ? input.localAppointments : [];
  const localAppointments = acceptInventoryAppointments(submitted, organizationId);
  const now = new Date(input.nowIso);
  try {
    const loaded = await fetchAppointmentInventoryDirectory(
      readOnlyInventoryClient(await createClient()),
      organizationId,
    );
    return buildLocalAppointmentInventory({
      organizationId,
      now,
      localAppointments,
      directory: inventoryDirectoryForPage(loaded, organizationId),
    });
  } catch (error: unknown) {
    return buildLocalAppointmentInventory({
      organizationId,
      now,
      localAppointments,
      directory: inventoryDirectoryForPage(
        {
          remoteCheck: "unavailable",
          message: error instanceof Error ? error.message : "無法讀取正式資料",
        },
        organizationId,
      ),
    });
  }
}
