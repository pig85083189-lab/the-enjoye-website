# Staff Navigation & Information Architecture

**Phase 4.7** · Navigation / App Shell / Role-aware visibility  
**Prerequisite:** Phase 4.5B tenant isolation · Phase 4.6 SaaS blueprint

Navigation visibility is **UX only**. Authorization remains membership + future server/RLS.

---

## Navigation invariants

1. **Navigation visibility is not authorization.**  
2. **Every tenant route operates inside resolved Organization context.**  
3. **Location switching cannot bypass Organization boundary** (`persistCurrentLocation` + `canAccessLocation`).  
4. **Mobile navigation contains only high-frequency workflows** (≤ 4 primary + More).  
5. **Treatment is context-driven**, not a primary mobile bottom destination.  
6. **Placeholder routes must not fabricate business data.**  
7. **Platform Admin navigation is not part of StaffShell.**

---

## Desktop IA (≥ 1200px)

Persistent sidebar (~232px):

```text
Beauty OS
{Organization name}
{Current location}

— unlabeled —
Today
Calendar
Customers
Treatments

Sales
  Checkout
  Packages
  Transactions
  Products (future)

CRM
  Follow Ups

Insights
  Reports

Team
  Staff

System
  Settings

— footer —
Location switcher
Current staff + role
Logout
```

Organization switch appears in footer **only when** the user has multiple accessible organizations (or DevTenantSwitcher in development).

---

## Tablet IA

- No full persistent sidebar.
- Sticky top bar: menu button + org/location/staff context.
- **Drawer** opens full IA (same catalog as desktop), Esc / backdrop to close.
- Bottom nav mirrors mobile primary tabs for one-thumb access.

---

## Mobile IA

Bottom navigation (max 4 + More):

| Tab | Route |
|-----|-------|
| 今天 | `/staff/today` |
| 行事曆 | `/staff/calendar` |
| 客戶 | `/staff/customers` |
| 更多 | `/staff/more` |

**More hub** groups remaining modules (Treatments, Sales, CRM, Reports, Staff, Settings) plus location context and logout.

Treatment workspace stays full-screen; enter via Today / Customer / Appointment — not a permanent bottom tab.

---

## Route map

| Route | Status | Notes |
|-------|--------|-------|
| `/staff/today` | ready | Existing dashboard |
| `/staff/calendar` | **ready** | Staff Day / Week (4.8A–4.8B.1) |
| `/staff/appointments` | redirect → calendar | Legacy; do not dual-maintain UI |
| `/staff/customers` (+ nested) | ready | CRM |
| `/staff/treatments` | placeholder list | |
| `/staff/treatments/new` · `[id]` | ready | Workspace |
| `/staff/checkout` | **ready** | Phase 4.9A CheckoutDraft → Transaction |
| `/staff/packages` | placeholder | |
| `/staff/transactions` | **ready** | Phase 4.9A list / detail |
| `/staff/products` | future | |
| `/staff/follow-ups` | placeholder | |
| `/staff/reports` | placeholder | |
| `/staff/staff` | **ready** | Staff schedule hours / breaks / time off (4.8B) |
| `/staff/settings` (+ org/locations) | ready hub | |
| `/staff/more` | ready | Mobile/tablet hub |
| `/staff/notifications` | kept, not primary nav | |

### Canonical decision: Calendar vs Appointments

**Canonical:** `/staff/calendar`  
**Legacy:** `/staff/appointments` → server `redirect` to calendar.

Rationale: one schedule surface for IA; avoids two appointment UIs.

---

## Role-aware visibility

Central config: `lib/navigation/config.ts` + `resolve.ts`.

```text
NavigationItem {
  id, label, href, icon, group,
  roles?, requiredPermissions?, mobilePriority?, status?
}
```

| Role | Notes (prototype) |
|------|-------------------|
| OWNER / MANAGER | Full catalog (incl. Staff, Settings, Reports) |
| STAFF | Ops modules; no Staff/Settings/Reports |
| RECEPTIONIST | Front desk; no Treatments list emphasis roles; has Checkout |
| ACCOUNTANT | Transactions / Reports; limited ops |

`requiredPermissions` are stubs for Phase 4.14 RBAC — not enforced as security.

---

## Organization / Location UX

| Surface | Behavior |
|---------|----------|
| Desktop sidebar header | Org name + current location label |
| Desktop footer | Location `<select>` via `switchLocation` |
| Org `<select>` | Only if `organizations.length > 1` |
| Mobile More | Location switcher card |
| Tablet header | Org · Location · Staff summary |
| Dev | `DevTenantSwitcher` (development only) |

All switches go through OrganizationContext → Phase 4.5B validators.

---

## Future permission integration

1. Keep `requiredPermissions` on items.  
2. Replace role arrays with permission resolution from membership.  
3. Server still denies unauthorized routes/data.  
4. Never treat hidden nav as ACL.

---

## Related code

- `lib/navigation/*` — catalog + resolve helpers  
- `components/layout/StaffShell.tsx` — shell chrome  
- `components/layout/StaffSidebar.tsx` · `BottomNavigation.tsx` · `StaffNavDrawer.tsx`  
- `components/navigation/*` — links, switcher, placeholders  
