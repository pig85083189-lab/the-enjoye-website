"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ImportantNotesAlert } from "@/components/customers/ImportantNotesAlert";
import { CustomerTagChips } from "@/components/customers/CustomerTagChips";
import { CustomerSummaryPanel } from "./CustomerSummaryPanel";
import { OverviewTab } from "./tabs/OverviewTab";
import { ConsultationsTab } from "./tabs/ConsultationsTab";
import { TreatmentsTab } from "./tabs/TreatmentsTab";
import { PhotosTab } from "./tabs/PhotosTab";
import { AppointmentsTab } from "./tabs/AppointmentsTab";
import { NotesTab } from "./tabs/NotesTab";
import { TransactionsTab } from "./tabs/TransactionsTab";
import { WalletTab } from "./tabs/WalletTab";
import { findAppointmentForCustomer } from "@/lib/appointment-store";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const TABS = [
  { id: "overview", label: "總覽" },
  { id: "consultation", label: "諮詢紀錄" },
  { id: "treatments", label: "療程紀錄" },
  { id: "photos", label: "照片" },
  { id: "appointments", label: "預約" },
  { id: "wallet", label: "錢包" },
  { id: "transactions", label: "交易紀錄" },
  { id: "notes", label: "內部備註" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface CustomerProfilePageProps {
  customerId: string;
}

export function CustomerProfilePage({ customerId }: CustomerProfilePageProps) {
  const router = useRouter();
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const customer = useCrmJson(
    () =>
      localCustomerRepository.getById({
        organizationId: organization.id,
        id: customerId,
      }) ?? null,
    null as Customer | null,
  );
  const [tab, setTab] = useState<TabId>("overview");
  const [showMore, setShowMore] = useState(false);

  const treatmentHref = useMemo(() => {
    if (!customer) return `/staff/treatments/new?customer=${customerId}`;
    const apt = findAppointmentForCustomer(customer.id, organization.id);
    return apt
      ? `/staff/treatments/new?customer=${customer.id}&appointment=${apt.id}`
      : `/staff/treatments/new?customer=${customer.id}`;
  }, [customer, customerId, organization.id]);

  if (!isClient) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-40 animate-pulse rounded-2xl bg-primary-light/50" />
        <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />
      </div>
    );
  }

  if (!customer) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">找不到此客戶</p>
        <p className="mt-2 text-sm text-secondary-text">
          Access unavailable — 此客戶不屬於目前店家，或資料不存在。
        </p>
        <Link href="/staff/customers" className="mt-3 inline-flex min-h-11 items-center text-primary">
          返回客戶管理
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/staff/customers"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          客戶管理
        </Link>
        <p className="text-xs text-secondary-text">僅供內部服務紀錄使用</p>
      </div>

      <Card padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-text sm:text-4xl">
              {customer.name}
            </h1>
            <CustomerTagChips tags={customer.tags} className="mt-3" />
            <dl className="mt-4 grid gap-3 text-[15px] sm:grid-cols-3">
              <div>
                <dt className="text-sm text-secondary-text">電話</dt>
                <dd className="mt-0.5 font-medium text-text">{customer.phone}</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary-text">加入日期</dt>
                <dd className="mt-0.5 font-medium text-text">{customer.joinedAt}</dd>
              </div>
              <div>
                <dt className="text-sm text-secondary-text">負責美容師</dt>
                <dd className="mt-0.5 font-medium text-text">
                  {customer.primaryStaffName ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={treatmentHref}>
              <Button className="min-h-11">新增療程紀錄</Button>
            </Link>
            <Link href="/staff/appointments">
              <Button variant="secondary" className="min-h-11">
                新增預約
              </Button>
            </Link>
            <Button variant="outline" className="min-h-11" disabled title="Prototype">
              編輯資料
            </Button>
            <div className="relative">
              <Button
                variant="ghost"
                className="min-h-11 min-w-11 px-3"
                aria-label="更多"
                onClick={() => setShowMore((v) => !v)}
              >
                <MoreHorizontal className="h-5 w-5" />
              </Button>
              {showMore ? (
                <div className="absolute right-0 z-20 mt-1 w-48 rounded-2xl border border-border bg-surface p-2 shadow-sm">
                  <Link
                    href={`/staff/customers/${customer.id}/consultation/new`}
                    className="block min-h-11 rounded-xl px-3 py-2 text-sm text-text hover:bg-primary-light/50"
                    onClick={() => setShowMore(false)}
                  >
                    新增諮詢更新
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <ImportantNotesAlert notes={customer.importantNotes ?? []} />

      {/* Summary under header on <1200 */}
      <div className="min-[1200px]:hidden">
        <CustomerSummaryPanel
          customer={customer}
          onStartTreatment={() => router.push(treatmentHref)}
          onAddNote={() => setTab("notes")}
        />
      </div>

      <div className="grid gap-5 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 overflow-x-auto border-b border-border pb-px">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "min-h-11 shrink-0 border-b-2 px-4 text-sm font-medium transition-colors",
                  tab === item.id
                    ? "border-primary text-primary"
                    : "border-transparent text-secondary-text hover:text-text",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <OverviewTab customer={customer} onOpenTreatments={() => setTab("treatments")} />
          ) : null}
          {tab === "consultation" ? <ConsultationsTab customerId={customer.id} /> : null}
          {tab === "treatments" ? <TreatmentsTab customerId={customer.id} /> : null}
          {tab === "photos" ? <PhotosTab customerId={customer.id} /> : null}
          {tab === "appointments" ? <AppointmentsTab customerId={customer.id} /> : null}
          {tab === "wallet" ? <WalletTab customerId={customer.id} /> : null}
          {tab === "transactions" ? <TransactionsTab customerId={customer.id} /> : null}
          {tab === "notes" ? <NotesTab customerId={customer.id} /> : null}
        </div>

        <aside className="hidden min-[1200px]:block">
          <div className="sticky top-6">
            <CustomerSummaryPanel
              customer={customer}
              onStartTreatment={() => router.push(treatmentHref)}
              onAddNote={() => setTab("notes")}
            />
          </div>
        </aside>
      </div>

      <div className="sticky bottom-20 z-10 pt-2 lg:hidden">
        <Button fullWidth size="lg" onClick={() => router.push(treatmentHref)}>
          開始療程
        </Button>
      </div>
    </div>
  );
}
