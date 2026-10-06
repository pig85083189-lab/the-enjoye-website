"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CustomerTagChips } from "@/components/customers/CustomerTagChips";
import { Customer360Tabs } from "./Customer360Tabs";
import { CustomerSummaryPanel } from "./CustomerSummaryPanel";
import { OverviewTab } from "./tabs/OverviewTab";
import { ConsultationsTab } from "./tabs/ConsultationsTab";
import { TreatmentsTab } from "./tabs/TreatmentsTab";
import { FollowUpsTab } from "./tabs/FollowUpsTab";
import { PhotosTab } from "./tabs/PhotosTab";
import { AppointmentsTab } from "./tabs/AppointmentsTab";
import { NotesTab } from "./tabs/NotesTab";
import { TransactionsTab } from "./tabs/TransactionsTab";
import { WalletTab } from "./tabs/WalletTab";
import { useCustomer360Snapshot } from "./use-customer-360";
import { useCustomerRemoteAppointments } from "@/features/customers/use-appointment-remote-read";
import { useCustomerRemoteDetail } from "@/features/customers/use-customer-remote-read";
import {
  isCommerceRemoteTransactionListReady,
  transactionsFromRemoteCommerceState,
  useCommerceRemoteTransactions,
} from "@/features/transactions/use-commerce-remote-transactions";
import { filterCommerceTransactionsByCustomerId } from "@/lib/customers/customer-360";
import {
  servicesFromRemoteListState,
  useServiceRemoteList,
} from "@/features/services/use-service-remote-read";
import {
  treatmentsFromRemoteListState,
  useTreatmentRemoteListByCustomer,
} from "@/features/treatments/use-treatment-remote-read";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { applyRosterStaffDisplayNames } from "@/lib/staff-auth/roster-display-name";
import { getMembership, listMemberships } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  customerConsultationNewHref,
  customerEditHref,
  isCustomer360TabId,
  type Customer360TabId,
  type Customer360WalletSection,
} from "@/lib/customers/customer-360";
import { resolveCustomer360AppointmentCreateSurface } from "@/lib/customers/customer-360-appointment-create-surface";
import type { Customer } from "@/types";

function isWalletSection(value: string | null): value is Customer360WalletSection {
  return value === "packages" || value === "stored-value";
}

interface CustomerProfilePageProps {
  customerId: string;
  remoteReadPilot?: boolean;
  appointmentRemoteReadPilot?: boolean;
  appointmentRemoteWritePilot?: boolean;
  treatmentRemoteReadPilot?: boolean;
  serviceRemoteReadPilot?: boolean;
  commerceRemoteReadPilot?: boolean;
  packageRemoteReadPilot?: boolean;
}

export function CustomerProfilePage({
  customerId,
  remoteReadPilot = false,
  appointmentRemoteReadPilot = false,
  appointmentRemoteWritePilot = false,
  treatmentRemoteReadPilot = false,
  serviceRemoteReadPilot = false,
  commerceRemoteReadPilot = false,
  packageRemoteReadPilot = false,
}: CustomerProfilePageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const localCustomer = useCrmJson(
    () =>
      remoteReadPilot
        ? null
        : localCustomerRepository.getById({
            organizationId: organization.id,
            id: customerId,
          }) ?? null,
    null as Customer | null,
  );
  const remote = useCustomerRemoteDetail(
    organization.id,
    customerId,
    remoteReadPilot,
  );
  const customer = remoteReadPilot
    ? remote.status === "data"
      ? remote.value
      : null
    : localCustomer;
  const initialTab = searchParams.get("tab");
  const initialSection = searchParams.get("section");
  const [tab, setTab] = useState<Customer360TabId>(
    isCustomer360TabId(initialTab) ? initialTab : "overview",
  );
  const [walletSection, setWalletSection] = useState<Customer360WalletSection | undefined>(
    isWalletSection(initialSection) ? initialSection : undefined,
  );
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const desktopMoreRef = useRef<HTMLDivElement>(null);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function bind(open: boolean, ref: RefObject<HTMLDivElement | null>, close: () => void) {
      if (!open) return () => undefined;
      function onPointer(event: MouseEvent) {
        if (!ref.current?.contains(event.target as Node)) close();
      }
      function onKey(event: KeyboardEvent) {
        if (event.key === "Escape") close();
      }
      document.addEventListener("mousedown", onPointer);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("mousedown", onPointer);
        document.removeEventListener("keydown", onKey);
      };
    }
    const a = bind(desktopMoreOpen, desktopMoreRef, () => setDesktopMoreOpen(false));
    const b = bind(mobileMoreOpen, mobileMoreRef, () => setMobileMoreOpen(false));
    return () => {
      a();
      b();
    };
  }, [desktopMoreOpen, mobileMoreOpen]);

  if (
    !isClient ||
    (remoteReadPilot && (remote.status === "loading" || remote.status === "off"))
  ) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-40 animate-pulse rounded-2xl bg-primary-light/50" />
        <div className="h-32 animate-pulse rounded-2xl bg-primary-light/40" />
      </div>
    );
  }

  if (remoteReadPilot && remote.status === "error") {
    return (
      <Card
        padding="lg"
        className="text-center"
        data-customer-read-state="error"
        data-customer-id={customerId}
      >
        <p className="text-[15px] font-medium text-text">無法載入客戶資料</p>
        <p className="mt-2 text-sm text-secondary-text">
          請稍後再試。
        </p>
        <Link href="/staff/customers" className="mt-3 inline-flex min-h-11 items-center text-primary">
          返回客戶管理
        </Link>
      </Card>
    );
  }

  if (!customer) {
    return (
      <Card
        padding="lg"
        className="text-center"
        data-customer-read-state={remoteReadPilot ? "empty" : "local-missing"}
        data-customer-id={customerId}
      >
        <p className="text-[15px] font-medium text-text">找不到此客戶</p>
        <p className="mt-2 text-sm text-secondary-text">
          此客戶不屬於目前店家，或資料不存在。
        </p>
        <Link href="/staff/customers" className="mt-3 inline-flex min-h-11 items-center text-primary">
          返回客戶管理
        </Link>
      </Card>
    );
  }

  return (
    <Customer360Workspace
      remoteReadPilot={remoteReadPilot}
      appointmentRemoteReadPilot={appointmentRemoteReadPilot}
      appointmentRemoteWritePilot={appointmentRemoteWritePilot}
      treatmentRemoteReadPilot={treatmentRemoteReadPilot}
      serviceRemoteReadPilot={serviceRemoteReadPilot}
      commerceRemoteReadPilot={commerceRemoteReadPilot}
      packageRemoteReadPilot={packageRemoteReadPilot}
      customer={customer}
      tab={tab}
      walletSection={walletSection}
      desktopMoreOpen={desktopMoreOpen}
      mobileMoreOpen={mobileMoreOpen}
      desktopMoreRef={desktopMoreRef}
      mobileMoreRef={mobileMoreRef}
      onDesktopMoreOpen={setDesktopMoreOpen}
      onMobileMoreOpen={setMobileMoreOpen}
      onSelectTab={(next, section) => {
        setTab(next);
        setWalletSection(next === "wallet" ? section ?? "packages" : undefined);
        const params = new URLSearchParams();
        params.set("tab", next);
        if (next === "wallet" && (section || walletSection)) {
          params.set("section", section ?? walletSection ?? "packages");
        }
        router.replace(`/staff/customers/${customer.id}?${params.toString()}`, { scroll: false });
      }}
    />
  );
}

function Customer360Workspace({
  remoteReadPilot = false,
  appointmentRemoteReadPilot = false,
  appointmentRemoteWritePilot = false,
  treatmentRemoteReadPilot = false,
  serviceRemoteReadPilot = false,
  commerceRemoteReadPilot = false,
  packageRemoteReadPilot = false,
  customer,
  tab,
  walletSection,
  desktopMoreOpen,
  mobileMoreOpen,
  desktopMoreRef,
  mobileMoreRef,
  onDesktopMoreOpen,
  onMobileMoreOpen,
  onSelectTab,
}: {
  remoteReadPilot?: boolean;
  appointmentRemoteReadPilot?: boolean;
  appointmentRemoteWritePilot?: boolean;
  treatmentRemoteReadPilot?: boolean;
  serviceRemoteReadPilot?: boolean;
  commerceRemoteReadPilot?: boolean;
  packageRemoteReadPilot?: boolean;
  customer: Customer;
  tab: Customer360TabId;
  walletSection?: Customer360WalletSection;
  desktopMoreOpen: boolean;
  mobileMoreOpen: boolean;
  desktopMoreRef: RefObject<HTMLDivElement | null>;
  mobileMoreRef: RefObject<HTMLDivElement | null>;
  onDesktopMoreOpen: (open: boolean) => void;
  onMobileMoreOpen: (open: boolean) => void;
  onSelectTab: (tab: Customer360TabId, section?: Customer360WalletSection) => void;
}) {
  const router = useRouter();
  const { organization } = useOrganization();
  const remoteAppointments = useCustomerRemoteAppointments(
    organization.id,
    customer.id,
    appointmentRemoteReadPilot,
  );
  const remoteTreatments = useTreatmentRemoteListByCustomer(
    organization.id,
    customer.id,
    treatmentRemoteReadPilot,
  );
  const remoteCatalog = useServiceRemoteList(
    organization.id,
    serviceRemoteReadPilot,
  );
  const remoteCommerce = useCommerceRemoteTransactions({
    organizationId: organization.id,
    enabled: commerceRemoteReadPilot,
  });
  const commerceTxReady =
    !commerceRemoteReadPilot || isCommerceRemoteTransactionListReady(remoteCommerce);
  const remoteTransactions = commerceRemoteReadPilot
    ? filterCommerceTransactionsByCustomerId(
        transactionsFromRemoteCommerceState(remoteCommerce),
        customer.id,
      )
    : null;
  const customerForView = {
    ...customer,
    primaryStaffName:
      customer.primaryStaffName ??
      (customer.primaryStaffId
        ? getMembership(organization.id, customer.primaryStaffId)?.displayName
        : undefined),
  };
  const snapshot = useCustomer360Snapshot(customerForView, {
    remoteAppointments: appointmentRemoteReadPilot
      ? applyRosterStaffDisplayNames(
          remoteAppointments.status === "data" ? remoteAppointments.value : [],
          listMemberships(organization.id),
        )
      : null,
    remoteTreatments: treatmentRemoteReadPilot
      ? treatmentsFromRemoteListState(remoteTreatments)
      : null,
    remoteCatalog: serviceRemoteReadPilot
      ? servicesFromRemoteListState(remoteCatalog)
      : null,
    remoteTransactions,
  });
  const createSurface = resolveCustomer360AppointmentCreateSurface({
    customerId: customer.id,
    customerRemoteReadPilot: remoteReadPilot,
    appointmentRemoteReadPilot,
    appointmentRemoteWritePilot,
  });
  const next = snapshot.nextAppointment;
  const initials = customer.name.slice(0, 1);
  const visitLabel =
    snapshot.visitCount > 0 ? `第 ${snapshot.visitCount} 次來店` : "尚未到店";

  if (commerceRemoteReadPilot && !commerceTxReady && remoteCommerce.status !== "error") {
    return (
      <div
        className="space-y-3"
        data-commerce-tx-source="remote-pilot"
        data-commerce-tx-state="loading"
      >
        <div className="h-10 w-40 animate-pulse rounded-2xl bg-primary-light/50" />
        <div className="h-32 animate-pulse rounded-2xl bg-primary-light/40" />
      </div>
    );
  }

  if (commerceRemoteReadPilot && remoteCommerce.status === "error") {
    return (
      <Card
        padding="lg"
        className="text-center"
        data-commerce-tx-source="remote-pilot"
        data-commerce-tx-state="error"
      >
        <p className="text-[15px] font-medium text-text">無法載入交易紀錄</p>
        <p className="mt-2 text-sm text-secondary-text">請稍後再試。</p>
      </Card>
    );
  }

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-[1180px] space-y-4 overflow-x-hidden pb-16 min-[768px]:pb-0"
      data-customer-read-source={remoteReadPilot ? "remote-pilot" : "local"}
      data-commerce-tx-source={commerceRemoteReadPilot ? "remote-pilot" : "local"}
      data-commerce-tx-state={
        commerceRemoteReadPilot
          ? remoteTransactions && remoteTransactions.length > 0
            ? "data"
            : "empty"
          : "local"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/staff/customers"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          客戶管理
        </Link>
      </div>

      <Card
        padding="md"
        data-customer-header
      >
        <div className="flex items-start gap-3 min-[1200px]:items-center min-[1200px]:gap-4">
          <Avatar initials={initials} size="lg" className="shrink-0 gap-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-text min-[1200px]:text-[22px]">
                {customer.name}
              </h1>
              <div className="hidden min-[768px]:block">
                <CustomerTagChips tags={customer.tags} max={4} />
              </div>
            </div>
            <p className="mt-1 truncate text-sm text-secondary-text min-[768px]:hidden">
              {customer.phone}
              <span className="mx-1.5 text-border">·</span>
              {visitLabel}
            </p>
            <p className="mt-0.5 truncate text-sm text-secondary-text min-[768px]:hidden">
              最近 {snapshot.lastVisitLabel ?? "—"}
              <span className="mx-1.5 text-border">·</span>
              下次 {next ? `${next.dateLabel} ${next.timeLabel}` : "尚未安排"}
            </p>
            <p className="mt-1 hidden truncate text-sm text-secondary-text min-[768px]:block">
              {customer.phone}
              <span className="mx-1.5 text-border">·</span>
              {visitLabel}
              <span className="mx-1.5 text-border">·</span>
              負責美容師 {customerForView.primaryStaffName ?? "尚未指定"}
            </p>
            <p className="mt-0.5 hidden truncate text-sm text-secondary-text min-[768px]:block">
              最近到店 {snapshot.lastVisitLabel ?? "—"}
              <span className="mx-1.5 text-border">·</span>
              下次預約{" "}
              {next ? (
                <span className="text-text">
                  {next.dateLabel} {next.timeLabel}
                </span>
              ) : (
                <>
                  尚未安排
                  {createSurface.href ? (
                    <Link
                      href={createSurface.href}
                      className="ml-2 font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      ＋ 安排預約
                    </Link>
                  ) : null}
                </>
              )}
            </p>
          </div>

          <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 min-[768px]:flex">
            <Button
              className="min-h-11"
              onClick={() => {
                router.push(snapshot.treatmentHref);
              }}
            >
              開始療程紀錄
            </Button>
            {createSurface.href ? (
              <Link href={createSurface.href}>
                <Button variant="secondary" className="min-h-11">
                  新增預約
                </Button>
              </Link>
            ) : (
              <Button variant="secondary" className="min-h-11" disabled>
                新增預約
              </Button>
            )}
            {remoteReadPilot ? (
              <Button variant="outline" className="min-h-11" disabled>
                編輯資料
              </Button>
            ) : (
              <Link href={customerEditHref(customer.id)}>
                <Button variant="outline" className="min-h-11">
                  編輯資料
                </Button>
              </Link>
            )}
            <HeaderMore
              customerId={customer.id}
              open={desktopMoreOpen}
              wrapRef={desktopMoreRef}
              onOpen={onDesktopMoreOpen}
              onNotes={() => onSelectTab("notes")}
              readOnly={remoteReadPilot}
            />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 min-[768px]:hidden">
          <CustomerTagChips tags={customer.tags} max={3} nowrap className="min-w-0 flex-1" />
          <Button
            data-customer-header-cta
            className="min-h-11 shrink-0 px-3 text-sm"
            onClick={() => {
              router.push(snapshot.treatmentHref);
            }}
          >
            開始療程
          </Button>
          <HeaderMore
            customerId={customer.id}
            open={mobileMoreOpen}
            wrapRef={mobileMoreRef}
            onOpen={onMobileMoreOpen}
            onNotes={() => onSelectTab("notes")}
            onFollowUp={() => onSelectTab("follow-ups")}
            includeEdit={!remoteReadPilot}
            createHref={createSurface.href ?? undefined}
            readOnly={remoteReadPilot}
          />
        </div>
      </Card>

      <details className="hidden min-[768px]:block min-[1200px]:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-2xl border border-border bg-surface px-4 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
          客戶摘要
          <span className="text-xs font-normal text-secondary-text">展開</span>
        </summary>
        <div className="mt-3">
            <CustomerSummaryPanel
            customer={customerForView}
            snapshot={snapshot}
            onStartTreatment={() => router.push(snapshot.treatmentHref)}
            onAddFollowUp={() => onSelectTab("follow-ups")}
            onOpenNotes={() => onSelectTab("notes")}
            readOnly={remoteReadPilot}
            allowCreateAppointment={Boolean(createSurface.href)}
          />
        </div>
      </details>

      <div className="grid min-w-0 gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_320px] min-[1200px]:gap-5">
        <div className="min-w-0 space-y-4">
          <Customer360Tabs
            tab={tab}
            walletSection={walletSection}
            onSelect={onSelectTab}
          />
          <div
            role="tabpanel"
            id={`customer-tabpanel-${tab}`}
            aria-labelledby={`customer-tab-${tab === "wallet" || tab === "transactions" ? "financial" : tab}`}
          >
            {tab === "overview" ? (
              <OverviewTab customer={customerForView} snapshot={snapshot} onOpenTab={onSelectTab} />
            ) : null}
            {tab === "consultation" ? <ConsultationsTab customerId={customer.id} /> : null}
            {tab === "treatments" ? (
              <TreatmentsTab
                customerId={customer.id}
                treatmentHref={snapshot.treatmentHref}
                treatmentRemoteReadPilot={treatmentRemoteReadPilot}
                catalog={
                  serviceRemoteReadPilot
                    ? servicesFromRemoteListState(remoteCatalog)
                    : null
                }
              />
            ) : null}
            {tab === "follow-ups" ? (
              <FollowUpsTab customerId={customer.id} treatmentHref={snapshot.treatmentHref} />
            ) : null}
            {tab === "photos" ? <PhotosTab customerId={customer.id} /> : null}
            {tab === "appointments" ? (
              <AppointmentsTab
                customerId={customer.id}
                createHref={createSurface.href ?? undefined}
                remoteReadPilot={appointmentRemoteReadPilot}
              />
            ) : null}
            {tab === "wallet" ? (
              <WalletTab
                customerId={customer.id}
                section={walletSection}
                onOpenTransactions={() => onSelectTab("transactions")}
                commerceRemoteRead={commerceRemoteReadPilot}
                packageRemoteRead={packageRemoteReadPilot}
                remoteTransactions={remoteTransactions}
              />
            ) : null}
            {tab === "transactions" ? (
              <TransactionsTab
                customerId={customer.id}
                commerceRemoteRead={commerceRemoteReadPilot}
                remoteTransactions={remoteTransactions}
              />
            ) : null}
            {tab === "notes" ? <NotesTab customerId={customer.id} /> : null}
          </div>
        </div>

        <aside className="hidden min-[1200px]:block">
          <div className="sticky top-6">
            <CustomerSummaryPanel
              customer={customerForView}
              snapshot={snapshot}
              onStartTreatment={() => router.push(snapshot.treatmentHref)}
              onAddFollowUp={() => onSelectTab("follow-ups")}
              onOpenNotes={() => onSelectTab("notes")}
              readOnly={remoteReadPilot}
              allowCreateAppointment={Boolean(createSurface.href)}
            />
          </div>
        </aside>
      </div>

      <MobileStickyTreatment href={snapshot.treatmentHref} />
    </div>
  );
}

function MobileStickyTreatment({
  href,
  readOnly = false,
}: {
  href: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = document.querySelector("[data-customer-header-cta]");
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 px-4 min-[768px]:hidden"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 0.5rem)" }}
    >
      <Button
        className="pointer-events-auto w-full shadow-[0_1px_2px_rgba(48,43,43,0.06)]"
        disabled={readOnly}
        onClick={() => {
          if (readOnly) return;
          router.push(href);
        }}
      >
        開始療程紀錄
      </Button>
    </div>
  );
}

function HeaderMore({
  customerId,
  open,
  wrapRef,
  onOpen,
  onNotes,
  onFollowUp,
  includeEdit = false,
  createHref,
  readOnly = false,
}: {
  customerId: string;
  open: boolean;
  wrapRef: RefObject<HTMLDivElement | null>;
  onOpen: (open: boolean) => void;
  onNotes: () => void;
  onFollowUp?: () => void;
  includeEdit?: boolean;
  createHref?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="ghost"
        className="min-h-11 min-w-11 px-3"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <MoreHorizontal className="h-5 w-5" />
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-48 rounded-2xl border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(48,43,43,0.08)]"
        >
          {createHref ? (
            <Link
              href={createHref}
              role="menuitem"
              className="flex min-h-11 items-center rounded-xl px-3 text-sm text-text hover:bg-[#FBF4F3]"
              onClick={() => onOpen(false)}
            >
              新增預約
            </Link>
          ) : null}
          {onFollowUp && !readOnly ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-text hover:bg-[#FBF4F3]"
              onClick={() => {
                onOpen(false);
                onFollowUp();
              }}
            >
              新增追蹤
            </button>
          ) : null}
          {includeEdit && !readOnly ? (
            <Link
              href={customerEditHref(customerId)}
              role="menuitem"
              className="flex min-h-11 items-center rounded-xl px-3 text-sm text-text hover:bg-[#FBF4F3]"
              onClick={() => onOpen(false)}
            >
              編輯資料
            </Link>
          ) : null}
          {readOnly ? null : (
            <Link
              href={customerConsultationNewHref(customerId)}
              role="menuitem"
              className="flex min-h-11 items-center rounded-xl px-3 text-sm text-text hover:bg-[#FBF4F3]"
              onClick={() => onOpen(false)}
            >
              新增諮詢更新
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-text hover:bg-[#FBF4F3]"
            onClick={() => {
              onOpen(false);
              onNotes();
            }}
          >
            內部備註
          </button>
        </div>
      ) : null}
    </div>
  );
}
