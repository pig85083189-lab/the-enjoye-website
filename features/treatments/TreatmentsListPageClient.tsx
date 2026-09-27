"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getServiceById } from "@/data";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import { getScheduleAppointment } from "@/lib/appointments/store";
import { resolveAppointmentCheckoutNav } from "@/lib/commerce/appointment-checkout-nav";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { listCompletedTreatmentsForOrganization } from "@/lib/repositories/local-treatment-repository";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import {
  getTreatmentDraftRevision,
  listOpenTreatmentDrafts,
  subscribeTreatmentDrafts,
} from "@/lib/treatment-draft";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { TreatmentDraft } from "@/types/treatment";

type FilterId = "open" | "completed" | "all";

type ListRow = {
  key: string;
  draft: TreatmentDraft;
  kind: "draft" | "completed";
  customerName: string;
  serviceName: string;
  staffName: string;
  locationName?: string;
  appointmentLabel?: string;
  appointmentStatus?: string;
};

function matchesLocation(
  draft: TreatmentDraft,
  locationId: string | undefined,
): boolean {
  if (!locationId) return true;
  if (!draft.locationId) return true;
  return draft.locationId === locationId;
}

function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${formatYmd(d)} ${formatHm(d)}`;
  } catch {
    return iso;
  }
}

export function TreatmentsListPageClient() {
  const { organization, currentLocation, locations } = useOrganization();
  const draftRev = useSyncExternalStore(
    subscribeTreatmentDrafts,
    () => getTreatmentDraftRevision(organization.id),
    () => "",
  );
  useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  const [filter, setFilter] = useState<FilterId>("open");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    void draftRev;
    const locationId = currentLocation?.id;
    const open = listOpenTreatmentDrafts(organization.id).filter((d) =>
      matchesLocation(d, locationId),
    );
    const completed = listCompletedTreatmentsForOrganization(
      organization.id,
    ).filter((d) => matchesLocation(d, locationId));

    const toRow = (
      draft: TreatmentDraft,
      kind: "draft" | "completed",
    ): ListRow => {
      const customer = localCustomerRepository.getById({
        organizationId: organization.id,
        id: draft.customerId,
      });
      const service = getServiceById(draft.serviceId, organization.id);
      const staff = getMembership(organization.id, draft.staffId);
      const apt = draft.appointmentId
        ? getScheduleAppointment(organization.id, draft.appointmentId)
        : undefined;
      const loc =
        draft.locationId &&
        locations.find((l) => l.id === draft.locationId)?.name;
      return {
        key: `${kind}-${draft.id}`,
        draft,
        kind,
        customerName: customer?.name ?? draft.customerId,
        serviceName: service?.name ?? draft.serviceId,
        staffName: staff?.displayName ?? draft.staffId,
        locationName: loc || undefined,
        appointmentLabel: apt
          ? `${formatYmd(new Date(apt.startAt))} ${formatHm(new Date(apt.startAt))}`
          : undefined,
        appointmentStatus: apt?.status,
      };
    };

    let list: ListRow[] = [];
    if (filter === "open") list = open.map((d) => toRow(d, "draft"));
    else if (filter === "completed")
      list = completed.map((d) => toRow(d, "completed"));
    else {
      list = [
        ...open.map((d) => toRow(d, "draft")),
        ...completed.map((d) => toRow(d, "completed")),
      ];
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (row) =>
          row.customerName.toLowerCase().includes(q) ||
          row.serviceName.toLowerCase().includes(q) ||
          row.staffName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [
    organization.id,
    currentLocation?.id,
    locations,
    filter,
    query,
    draftRev,
  ]);

  const emptyMessage = (() => {
    if (query.trim()) return "找不到符合搜尋條件的療程";
    if (filter === "open") return "尚無進行中的療程";
    if (filter === "completed") return "尚無已完成療程";
    return "尚無療程紀錄";
  })();

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            療程紀錄
          </h1>
          <p className="mt-1 text-sm text-secondary-text">
            草稿匣與已完成療程 · 繼續編輯或前往結帳
          </p>
        </div>
        <Link href="/staff/treatments/new">
          <Button className="min-h-11">+ 新增療程</Button>
        </Link>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "open", label: "進行中 / 草稿" },
              { id: "completed", label: "已完成" },
              { id: "all", label: "全部" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "min-h-11 rounded-2xl px-4 text-sm font-medium transition-colors",
                filter === item.id
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-secondary-text hover:bg-primary-light/40",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋客戶、服務、員工"
          className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] outline-none ring-primary/30 focus:ring-2 sm:max-w-xs"
          aria-label="搜尋療程"
        />
      </div>

      {rows.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="text-[15px] font-medium text-text">{emptyMessage}</p>
          {filter === "open" && !query.trim() ? (
            <p className="mt-2 text-sm text-secondary-text">
              從今天或客戶開始服務後，未完成的療程會出現在這裡。
            </p>
          ) : null}
        </Card>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-secondary-text">
                  <th className="px-3 py-3 font-medium">客戶</th>
                  <th className="px-3 py-3 font-medium">服務</th>
                  <th className="px-3 py-3 font-medium">員工</th>
                  <th className="px-3 py-3 font-medium">預約時間</th>
                  <th className="px-3 py-3 font-medium">狀態</th>
                  <th className="px-3 py-3 font-medium">更新</th>
                  <th className="px-3 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TreatmentTableRow key={row.key} row={row} orgId={organization.id} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <TreatmentMobileCard key={row.key} row={row} orgId={organization.id} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TreatmentActions({
  row,
  orgId,
  stacked,
}: {
  row: ListRow;
  orgId: string;
  stacked?: boolean;
}) {
  const primaryHref =
    row.kind === "draft"
      ? `/staff/treatments/new?customer=${row.draft.customerId}&appointment=${row.draft.appointmentId}`
      : `/staff/treatments/${row.draft.id}`;
  const primaryLabel = row.kind === "draft" ? "繼續療程" : "查看紀錄";

  const checkoutNav =
    row.draft.appointmentId && row.appointmentStatus
      ? resolveAppointmentCheckoutNav(
          orgId,
          row.draft.appointmentId,
          row.appointmentStatus,
        )
      : { kind: "none" as const };

  return (
    <div
      className={cn(
        "flex gap-2",
        stacked ? "flex-col" : "flex-wrap items-center",
      )}
    >
      <Link href={primaryHref} className={stacked ? "block w-full" : undefined}>
        <Button
          className="min-h-11"
          fullWidth={stacked}
          size={stacked ? "lg" : "md"}
        >
          {primaryLabel}
        </Button>
      </Link>
      {checkoutNav.kind === "checkout" ? (
        <Link href={checkoutNav.href} className={stacked ? "block w-full" : undefined}>
          <Button
            variant="secondary"
            className="min-h-11"
            fullWidth={stacked}
          >
            前往結帳
          </Button>
        </Link>
      ) : null}
      {checkoutNav.kind === "view_transaction" ? (
        <Link href={checkoutNav.href} className={stacked ? "block w-full" : undefined}>
          <Button variant="outline" className="min-h-11" fullWidth={stacked}>
            查看交易
          </Button>
        </Link>
      ) : null}
    </div>
  );
}

function TreatmentTableRow({ row, orgId }: { row: ListRow; orgId: string }) {
  return (
    <tr className="border-b border-border/80 align-top">
      <td className="px-3 py-3">
        <p className="font-medium text-text">{row.customerName}</p>
        {row.locationName ? (
          <p className="mt-0.5 text-xs text-secondary-text">{row.locationName}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-text">{row.serviceName}</td>
      <td className="px-3 py-3 text-secondary-text">{row.staffName}</td>
      <td className="px-3 py-3 text-secondary-text">
        {row.appointmentLabel ?? "—"}
      </td>
      <td className="px-3 py-3">
        <StatusPill kind={row.kind} />
      </td>
      <td className="px-3 py-3 text-secondary-text">
        {formatUpdatedAt(row.draft.updatedAt)}
      </td>
      <td className="px-3 py-3">
        <TreatmentActions row={row} orgId={orgId} />
      </td>
    </tr>
  );
}

function TreatmentMobileCard({ row, orgId }: { row: ListRow; orgId: string }) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-text">{row.customerName}</p>
            <p className="mt-1 text-sm text-secondary-text">{row.serviceName}</p>
          </div>
          <StatusPill kind={row.kind} />
        </div>
        <p className="text-sm text-secondary-text">
          {row.appointmentLabel ?? "無預約時間"}
          <span className="mx-1.5 text-border">·</span>
          {row.staffName}
        </p>
        <TreatmentActions row={row} orgId={orgId} stacked />
      </div>
    </Card>
  );
}

function StatusPill({ kind }: { kind: "draft" | "completed" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        kind === "draft"
          ? "bg-amber-50 text-amber-800"
          : "bg-emerald-50 text-emerald-800",
      )}
    >
      {kind === "draft" ? "草稿" : "已完成"}
    </span>
  );
}
