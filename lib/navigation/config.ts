import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Package,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingBag,
  Sparkles,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { NavigationGroup, NavigationItem } from "./types";

/**
 * Canonical schedule route is /staff/calendar.
 * /staff/appointments redirects there (do not maintain two UIs).
 */
export const CANONICAL_CALENDAR_HREF = "/staff/calendar";
export const LEGACY_APPOINTMENTS_HREF = "/staff/appointments";

export const NAV_GROUPS: NavigationGroup[] = [
  { id: "primary", label: "", unlabeled: true },
  { id: "sales", label: "銷售" },
  { id: "crm", label: "CRM" },
  { id: "insights", label: "洞察" },
  { id: "team", label: "團隊" },
  { id: "system", label: "系統" },
];

/**
 * Central staff navigation catalog.
 * Visibility ≠ authorization — see docs/saas/navigation-ia.md.
 */
export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: "today",
    label: "今天",
    href: "/staff/today",
    icon: Sparkles,
    group: "primary",
    mobilePriority: 1,
    status: "ready",
    description: "今日預約與開始服務",
    requiredPermissions: ["today.read"],
  },
  {
    id: "calendar",
    label: "行事曆",
    href: CANONICAL_CALENDAR_HREF,
    icon: CalendarDays,
    group: "primary",
    mobilePriority: 2,
    status: "ready",
    description: "預約排程與到店狀態",
    requiredPermissions: ["calendar.read"],
  },
  {
    id: "customers",
    label: "客戶",
    href: "/staff/customers",
    icon: Users,
    group: "primary",
    mobilePriority: 3,
    status: "ready",
    description: "客戶 CRM、諮詢與備註",
    requiredPermissions: ["customer.read"],
  },
  {
    id: "treatments",
    label: "療程",
    href: "/staff/treatments",
    icon: ClipboardList,
    group: "primary",
    status: "placeholder",
    description: "療程紀錄列表與草稿入口",
    requiredPermissions: ["treatment.read"],
    roles: ["OWNER", "MANAGER", "STAFF"],
  },
  {
    id: "checkout",
    label: "結帳",
    href: "/staff/checkout",
    icon: Wallet,
    group: "sales",
    status: "ready",
    description: "服務結帳與付款",
    requiredPermissions: ["checkout.create"],
    roles: ["OWNER", "MANAGER", "RECEPTIONIST", "STAFF"],
  },
  {
    id: "packages",
    label: "套票",
    href: "/staff/packages",
    icon: Package,
    group: "sales",
    status: "ready",
    description: "套票定義與堂數 Ledger",
    requiredPermissions: ["package.read"],
    roles: ["OWNER", "MANAGER", "RECEPTIONIST", "STAFF"],
  },
  {
    id: "transactions",
    label: "交易紀錄",
    href: "/staff/transactions",
    icon: Receipt,
    group: "sales",
    status: "ready",
    description: "交易與付款紀錄",
    requiredPermissions: ["transaction.read"],
    roles: ["OWNER", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
  },
  {
    id: "products",
    label: "商品",
    href: "/staff/products",
    icon: ShoppingBag,
    group: "sales",
    status: "future",
    description: "零售商品（後續 Phase）",
    requiredPermissions: ["product.read"],
    roles: ["OWNER", "MANAGER", "RECEPTIONIST"],
  },
  {
    id: "follow-ups",
    label: "追蹤",
    href: "/staff/follow-ups",
    icon: RefreshCw,
    group: "crm",
    status: "placeholder",
    description: "回訪與再預約任務",
    requiredPermissions: ["crm.read"],
  },
  {
    id: "reports",
    label: "報表",
    href: "/staff/reports",
    icon: LayoutDashboard,
    group: "insights",
    status: "placeholder",
    description: "營收與服務洞察（尚未計算真實數據）",
    requiredPermissions: ["report.read"],
    roles: ["OWNER", "MANAGER", "ACCOUNTANT"],
  },
  {
    id: "staff",
    label: "員工",
    href: "/staff/staff",
    icon: UserCog,
    group: "team",
    status: "placeholder",
    description: "員工與角色（RBAC 預留）",
    requiredPermissions: ["staff.manage"],
    roles: ["OWNER", "MANAGER"],
  },
  {
    id: "settings",
    label: "設定",
    href: "/staff/settings",
    icon: Settings,
    group: "system",
    status: "ready",
    description: "店家與分店設定",
    requiredPermissions: ["settings.manage"],
    roles: ["OWNER", "MANAGER"],
  },
];

/** Mobile bottom bar — max 4 primary destinations + More is separate hub */
export const MOBILE_MORE_HREF = "/staff/more";
