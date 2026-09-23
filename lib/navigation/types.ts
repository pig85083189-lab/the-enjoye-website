import type { LucideIcon } from "lucide-react";
import type { StaffRole } from "@/types/saas";

/** Future RBAC permission keys — navigation visibility only in Phase 4.7 */
export type NavPermission =
  | "today.read"
  | "calendar.read"
  | "customer.read"
  | "treatment.read"
  | "checkout.create"
  | "package.read"
  | "transaction.read"
  | "product.read"
  | "crm.read"
  | "report.read"
  | "staff.manage"
  | "settings.manage";

export type NavGroupId =
  | "primary"
  | "sales"
  | "crm"
  | "insights"
  | "team"
  | "system";

export type NavItemStatus = "ready" | "placeholder" | "future";

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Roles that can see this item. Empty/undefined = all staff roles. */
  roles?: StaffRole[];
  /** Future permission hooks — documented for Phase 4.14 */
  requiredPermissions?: NavPermission[];
  /** Order in mobile bottom nav; undefined = not a primary mobile tab */
  mobilePriority?: number;
  status?: NavItemStatus;
  description?: string;
  /** Match nested paths under href (default true) */
  matchPrefix?: boolean;
}

export interface NavigationGroup {
  id: NavGroupId;
  label: string;
  /** Flat items without a section label in sidebar */
  unlabeled?: boolean;
}
