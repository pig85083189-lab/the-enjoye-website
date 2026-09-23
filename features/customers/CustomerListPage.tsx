"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { CustomerTagChips } from "@/components/customers/CustomerTagChips";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";
import {
  FILTER_OPTIONS,
  SORT_OPTIONS,
  filterCustomers,
  listStatusLabel,
  sortCustomers,
  type CustomerListFilter,
  type CustomerListSort,
} from "./customer-list-utils";

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-primary-light/40" />
      ))}
    </div>
  );
}

function statusTone(customer: Customer): string {
  if (customer.listStatus === "needs_follow_up") return "text-[#B07A4A]";
  if (customer.listStatus === "inactive") return "text-secondary-text";
  return "text-success";
}

export function CustomerListPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const customers = useCrmJson(
    () => localCustomerRepository.list({ organizationId: organization.id }),
    [] as Customer[],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerListFilter>("all");
  const [sort, setSort] = useState<CustomerListSort>("lastVisit");

  const visible = useMemo(
    () => sortCustomers(filterCustomers(customers, filter, query), sort),
    [customers, filter, query, sort],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="客戶管理"
        description="管理客戶資料、諮詢紀錄與療程歷史"
        actions={
          <Link href="/staff/customers/new">
            <Button className="min-h-11">
              <Plus className="h-4 w-4" aria-hidden />
              新增客戶
            </Button>
          </Link>
        }
      />

      <p className="text-xs text-secondary-text">
        {organization.name} · 僅供內部服務紀錄使用
      </p>

      <Card padding="md" className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-text"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋姓名、手機號碼"
            className="min-h-11 w-full rounded-2xl border border-border bg-surface pl-10 pr-4 text-[15px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
            aria-label="搜尋客戶"
          />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTER_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "min-h-11 shrink-0 rounded-2xl px-4 text-sm font-medium transition-colors",
                  filter === item.id
                    ? "bg-primary text-white"
                    : "bg-primary-light/60 text-text hover:bg-primary-light",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm text-secondary-text">
            排序
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CustomerListSort)}
              className="min-h-11 rounded-2xl border border-border bg-surface px-3 text-[15px] text-text outline-none"
            >
              {SORT_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {!isClient ? (
        <ListSkeleton />
      ) : visible.length === 0 ? (
        <Card padding="lg" className="text-center">
          <Users className="mx-auto h-10 w-10 text-primary/50" aria-hidden />
          <p className="mt-3 text-[15px] font-medium text-text">
            {query || filter !== "all" ? "找不到符合的客戶" : "尚無客戶資料"}
          </p>
          <p className="mt-1 text-sm text-secondary-text">
            {query || filter !== "all" ? "試試調整搜尋或篩選條件" : "點右上角新增第一位客戶"}
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden min-[1200px]:block overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-[15px]">
              <thead className="bg-primary-light/40 text-sm text-secondary-text">
                <tr>
                  <th className="px-4 py-3 font-medium">客戶</th>
                  <th className="px-4 py-3 font-medium">手機</th>
                  <th className="px-4 py-3 font-medium">標籤</th>
                  <th className="px-4 py-3 font-medium">最近服務</th>
                  <th className="px-4 py-3 font-medium">最近到店</th>
                  <th className="px-4 py-3 font-medium">下次預約</th>
                  <th className="px-4 py-3 font-medium">負責美容師</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((customer) => (
                  <tr
                    key={customer.id}
                    className="cursor-pointer border-t border-border transition-colors hover:bg-primary-light/25"
                    onClick={() => {
                      router.push(`/staff/customers/${customer.id}`);
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar initials={customer.name.slice(0, 1)} size="sm" />
                        <span className="font-medium text-text">{customer.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text">{customer.phone}</td>
                    <td className="px-4 py-3">
                      <CustomerTagChips tags={customer.tags} max={3} />
                    </td>
                    <td className="px-4 py-3 text-text">{customer.lastServiceName ?? "—"}</td>
                    <td className="px-4 py-3 text-text">{customer.lastVisit || "—"}</td>
                    <td className="px-4 py-3 text-text">
                      {customer.nextAppointmentLabel ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text">
                      {customer.primaryStaffName ?? "—"}
                    </td>
                    <td className={cn("px-4 py-3 font-medium", statusTone(customer))}>
                      {listStatusLabel(customer)}
                    </td>
                    <td className="px-4 py-3 text-secondary-text">
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="space-y-3 min-[1200px]:hidden">
            {visible.map((customer) => (
              <Link key={customer.id} href={`/staff/customers/${customer.id}`} className="block">
                <Card padding="md" className="transition-colors hover:border-primary/30">
                  <div className="flex items-start gap-3">
                    <Avatar initials={customer.name.slice(0, 1)} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-base font-semibold text-text">{customer.name}</p>
                          <p className="mt-0.5 text-sm text-secondary-text">{customer.phone}</p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-secondary-text" />
                      </div>
                      <CustomerTagChips tags={customer.tags} max={3} className="mt-2" />
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <dt className="text-secondary-text">最近到店</dt>
                          <dd className="font-medium text-text">{customer.lastVisit || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-secondary-text">下次預約</dt>
                          <dd className="font-medium text-text">
                            {customer.nextAppointmentLabel ?? "尚無"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
