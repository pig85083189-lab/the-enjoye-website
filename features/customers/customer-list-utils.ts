import type { Customer } from "@/types";
import { normalizePhone } from "@/lib/phone";

export type CustomerListFilter = "all" | "recent" | "needs_follow_up" | "new" | "vip";
export type CustomerListSort = "lastVisit" | "createdAt" | "name";

export const FILTER_OPTIONS: Array<{ id: CustomerListFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "recent", label: "近期到店" },
  { id: "needs_follow_up", label: "需要追蹤" },
  { id: "new", label: "新客" },
  { id: "vip", label: "VIP" },
];

export const SORT_OPTIONS: Array<{ id: CustomerListSort; label: string }> = [
  { id: "lastVisit", label: "最近到店" },
  { id: "createdAt", label: "最近新增" },
  { id: "name", label: "姓名" },
];

function parseVisitDate(value: string): number {
  const normalized = value.replace(/\//g, "-");
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? 0 : t;
}

export function matchesCustomerSearch(customer: Customer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (customer.name.toLowerCase().includes(q)) return true;
  const phoneQ = normalizePhone(q);
  if (phoneQ && normalizePhone(customer.phone).includes(phoneQ)) return true;
  return false;
}

export function filterCustomers(
  customers: Customer[],
  filter: CustomerListFilter,
  query: string,
): Customer[] {
  return customers.filter((c) => {
    if (!matchesCustomerSearch(c, query)) return false;
    if (filter === "all") return true;
    if (filter === "vip") return c.membership === "vip" || c.tags.some((t) => t.id === "vip");
    if (filter === "new") return c.membership === "new" || c.tags.some((t) => t.id === "new");
    if (filter === "needs_follow_up") {
      return c.listStatus === "needs_follow_up" || c.tags.some((t) => t.id === "needs_follow_up");
    }
    if (filter === "recent") {
      const days = (Date.now() - parseVisitDate(c.lastVisit)) / (1000 * 60 * 60 * 24);
      return days >= 0 && days <= 14;
    }
    return true;
  });
}

export function sortCustomers(customers: Customer[], sort: CustomerListSort): Customer[] {
  const next = [...customers];
  next.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-Hant");
    if (sort === "createdAt") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return parseVisitDate(b.lastVisit) - parseVisitDate(a.lastVisit);
  });
  return next;
}

export function listStatusLabel(customer: Customer): string {
  if (customer.listStatus === "needs_follow_up") return "需追蹤";
  if (customer.listStatus === "inactive") return "停用";
  return "正常";
}
