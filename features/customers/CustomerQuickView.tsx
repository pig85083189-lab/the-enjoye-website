"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { AlertCircle, CalendarPlus, ChevronRight, Crown, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  collectCustomerAttentionNotes,
  membershipBadge,
  serviceInterestTags,
  sourceLabel,
  type AppointmentHint,
  type ServiceCatalogHint,
} from "@/lib/customers/crm-derived";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";

const WORKSPACE_RADIUS_CLASS = "rounded-2xl";
const ROSE_FILL = "bg-[#C56B70]";
const ROSE_HOVER = "hover:bg-[#B85F64]";

interface CustomerQuickViewProps {
  customer: Customer;
  appointments: AppointmentHint[];
  catalog: ServiceCatalogHint[];
  now: Date;
  extras?: string[];
  onClose: () => void;
}

export function CustomerQuickView({
  customer,
  appointments,
  catalog,
  now,
  extras = [],
  onClose,
}: CustomerQuickViewProps) {
  const [tab, setTab] = useState<"summary" | "full">("summary");
  const { organization } = useOrganization();
  const [packages,setPackages] = useState<{key:string;name?:string;remaining?:number;total?:number;usedAt?:string;error?:boolean}|null>(null);
  const packageKey = organization.id+":"+customer.id;
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({organizationId:organization.id,customerId:customer.id});
    void (async()=>{
      try{
        const response=await fetch("/api/staff/packages/overview?"+params,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("read failed");
        const data=await response.json();
        if(!Array.isArray(data.purchases)||!Array.isArray(data.balances)||!Array.isArray(data.ledger))throw new Error("invalid");
        const pkg=data.purchases[0];
        const remaining=pkg?data.balances.find((b:{customer_package_id:string;ledger_balance:number})=>b.customer_package_id===pkg.id)?.ledger_balance:undefined;
        const usedAt=pkg?data.ledger.find((e:{customer_package_id:string;type:string;created_at:string})=>e.customer_package_id===pkg.id&&e.type==="REDEMPTION")?.created_at:undefined;
        if(!controller.signal.aborted)setPackages({key:packageKey,name:pkg?.name_snapshot,remaining,total:pkg?.session_count_snapshot,usedAt});
      }catch{if(!controller.signal.aborted)setPackages({key:packageKey,error:true});}
    })();
    return ()=>controller.abort();
  },[organization.id,customer.id,packageKey]);
  const membership = membershipBadge(customer);
  const interest = serviceInterestTags(customer);
  const attention = collectCustomerAttentionNotes(customer, extras);
  const source = sourceLabel(customer.source);
  const notes = customer.preferences?.notes?.trim() || "";
  const createHref = `/staff/calendar?create=1&customer=${customer.id}`;
  const profileHref = `/staff/customers/${customer.id}`;
  const editHref = `/staff/customers/${customer.id}/edit`;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[1200px]:hidden"
        aria-label="關閉客戶摘要"
        onClick={onClose}
      />
      <aside
        data-customer-quickview
        role="dialog"
        aria-modal="true"
        aria-label={`${customer.name}的客戶摘要`}
        className={cn(
          "z-50 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-6.5rem)] min-[1200px]:w-[325px] min-[1200px]:min-w-[325px] min-[1200px]:shrink-0 min-[1200px]:shadow-none",
          WORKSPACE_RADIUS_CLASS,
        )}
      >
        <div className="flex shrink-0 items-center justify-end px-5 pt-3.5 pb-1">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-5 pb-2.5">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[15px] font-semibold text-primary"
            aria-hidden
          >
            {customer.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="whitespace-nowrap text-[15px] font-semibold text-text">
                {customer.name}
              </h2>
              {membership ? (
                <Badge
                  tone={membership.id === "vip" ? "vip" : "new"}
                  className="px-1.5 py-px text-[10px]"
                >
                  {membership.id === "vip" ? (
                    <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                  ) : null}
                  {membership.label}
                </Badge>
              ) : null}
            </div>
            {customer.phone ? (
              <p className="mt-0.5 whitespace-nowrap text-[12px] text-secondary-text">
                {customer.phone}
              </p>
            ) : null}
            <p className="text-[12px] text-secondary-text">
              {customer.totalVisits > 0 ? `第 ${customer.totalVisits} 次來店` : "尚未到店"}
              {customer.tags.some((tag) => tag.id === "regular") ? " · 熟客" : ""}
            </p>
            {interest.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {interest.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-[#F6F1EE] px-1.5 py-px text-[10px] text-secondary-text"
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-5 border-b border-border px-5">
          <button
            type="button"
            onClick={() => setTab("summary")}
            className={cn(
              "-mb-px border-b-2 pb-1.5 text-[13px] font-medium",
              tab === "summary"
                ? "border-[#C56B70] text-[#C56B70]"
                : "border-transparent text-secondary-text hover:text-text",
            )}
          >
            客戶摘要
          </button>
          <Link
            href={profileHref}
            className={cn(
              "-mb-px border-b-2 pb-1.5 text-[13px] font-medium",
              tab === "full"
                ? "border-[#C56B70] text-[#C56B70]"
                : "border-transparent text-secondary-text hover:text-text",
            )}
            onClick={() => setTab("full")}
          >
            完整資料
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
          <section className="rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-text">基本資訊</p>
            <dl className="mt-2 space-y-2 text-[13px]">
              <InfoRow label="手機" value={customer.phone || "—"} nowrap />
              {customer.birthday ? (
                <InfoRow label="生日" value={customer.birthday} />
              ) : null}
              {source ? <InfoRow label="來源" value={source} /> : null}
              {notes ? <InfoRow label="備註" value={notes} /> : null}
            </dl>
          </section>

          <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <Link
              href={`${profileHref}?tab=treatments`}
              className="flex items-center justify-between text-[13px] font-semibold text-text"
            >
              服務紀錄
              <ChevronRight className="h-3.5 w-3.5 text-secondary-text" aria-hidden />
            </Link>
          </section>

          <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <Link
              href={`${profileHref}?tab=appointments`}
              className="flex items-center justify-between text-[13px] font-semibold text-text"
            >
              下次預約
              <ChevronRight className="h-3.5 w-3.5 text-secondary-text" aria-hidden />
            </Link>
            <Link
              href={createHref}
              className="mt-2.5 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-[#C56B70]"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              安排預約
            </Link>
          </section>

          <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <Link href={profileHref+"?tab=wallet&section=packages"} className="flex items-center justify-between text-[13px] font-semibold text-text">
              套票紀錄 <ChevronRight className="h-3.5 w-3.5 text-secondary-text" aria-hidden />
            </Link>
            {packages?.key!==packageKey ? <p className="mt-2 text-[13px] text-secondary-text">正在讀取正式套票…</p>
              : packages.error ? <p className="mt-2 text-[13px] text-secondary-text">暫時無法讀取正式套票</p>
              : packages.name ? <div className="mt-2 text-[12px] text-secondary-text">
                  <p className="text-[13px] font-medium text-text">{packages.name}</p>
                  <p>剩餘 {packages.remaining??"待確認"} / {packages.total} 堂</p>
                  {packages.usedAt ? <p>最近核銷：{new Date(packages.usedAt).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"})}</p> : null}
                </div>
              : <p className="mt-2 text-[13px] text-secondary-text">尚無已購套票</p>}
          </section>

          {attention.length > 0 ? (
            <section className="mt-3.5 rounded-2xl bg-[#F8F1F1] px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#B15B5B]">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                需要留意
              </p>
              <ul className="mt-2 space-y-1">
                {attention.map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-[12px] leading-relaxed text-secondary-text"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C9797D]" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-2.5">
              <p className="text-[13px] font-semibold text-text">需要留意</p>
              <p className="mt-1.5 text-[12px] text-secondary-text">
                近期無特別注意事項
              </p>
            </section>
          )}
        </div>

        <div className="shrink-0 space-y-1.5 px-5 pt-1.5 pb-5">
          <Link
            href={createHref}
            className={cn(
              "inline-flex h-[50px] min-h-[50px] w-full items-center justify-center gap-1.5 rounded-full text-[15px] font-medium text-white transition-colors",
              ROSE_FILL,
              ROSE_HOVER,
            )}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            新增預約
          </Link>
          <Link href={editHref} className="block">
            <Button
              variant="outline"
              className="h-10 min-h-10 w-full rounded-full text-[13px]"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              編輯客戶資料
            </Button>
          </Link>
          <Link
            href={profileHref}
            className="inline-flex h-9 w-full items-center justify-center gap-1 text-[13px] font-medium text-secondary-text transition-colors hover:text-primary"
          >
            查看完整資料
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </aside>
    </>
  );
}

function InfoRow({
  label,
  value,
  nowrap,
}: {
  label: string;
  value: string;
  nowrap?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-secondary-text">{label}</dt>
      <dd
        className={cn(
          "text-right font-medium text-text",
          nowrap && "whitespace-nowrap",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
