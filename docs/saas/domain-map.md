# Domain Map — Beauty OS

Phase 4.6 blueprint. Domains listed here are **not** all scheduled for implementation.

## Hierarchy reminder

```text
Platform → Organization → Location
                 ↓
           StaffMembership (User)
                 ↓
        Tenant business domains
```

---

## 1. TENANCY

| Domain | Description | Primary owner |
|--------|-------------|---------------|
| Organizations | Tenant root: brand, locale, currency, status | Platform creates; Org owns its profile |
| Locations | Physical stores | Organization |
| Staff Memberships | User ↔ Org relationship, role, location access | Organization |
| Users / Profiles | Login identity | Platform (Auth); profile display name may be org-local via membership |

---

## 2. CUSTOMER

| Domain | Description | Owner |
|--------|-------------|-------|
| Customers | Identity, contact, membership tier, tags | Organization |
| Customer Profiles | Preferences, alerts, tracking focus | Organization |
| Consultations | Digital consultation versions (immutable history) | Organization |
| Customer Tags | VIP / new / follow-up / custom | Organization |
| Customer Notes | Internal staff notes (not medical chart) | Organization |
| Customer Photos (CRM) | Before/after/follow-up metadata | Organization (+ optional location/treatment refs) |

**Decision:** Customer is **Organization-owned** and shared across Locations of the same brand.

---

## 3. SERVICE

| Domain | Description | Owner |
|--------|-------------|-------|
| Services | Sellable / bookable offerings | Organization |
| Service Categories | Grouping for menu / reports | Organization |
| Treatment Templates | Assessment/body-map/ops presets by `serviceType` | **Platform catalog** (presentation templates); org services services → template type |

Templates (`BREAST`, `GENERIC`, …) are platform UX recipes. Service rows (price, duration, name) are tenant-owned.

---

## 4. APPOINTMENT

| Domain | Description | Owner |
|--------|-------------|-------|
| Appointments | Scheduled visit | Organization + **Location-scoped** |
| Appointment Status | Lifecycle state | Same as appointment |
| Check-in | Arrival event | Location-scoped event |
| Cancellation / No-show | Terminal outcomes | Location-scoped |
| Rebooking | Link from follow-up / CRM task → new appointment | Organization + Location |

---

## 5. TREATMENT

| Domain | Description | Owner |
|--------|-------------|-------|
| Treatments | Completed / draft service records | Organization + optional Location |
| Assessment | Concerns, sensitivity, comparison | Part of Treatment |
| Body Markers | Area/condition map | Part of Treatment |
| Operations | Techniques performed | Part of Treatment |
| Products Used | Products during session | Part of Treatment (≠ retail Product sale) |
| Photos | Session photo metadata | Part of Treatment |
| Professional Notes | Therapist summary | Part of Treatment |
| Follow Up (session) | Tags, suggested return date | Part of Treatment → may spawn CRM Follow-up |

Aligns with current workflow:

`Summary → Assessment → Body Map → Operations → Photos → Professional Note → Follow Up → Complete`

---

## 6. PACKAGE / CREDIT

| Domain | Description | Owner |
|--------|-------------|-------|
| Packages | Productized session bundles (catalog) | Organization |
| Customer Packages | Instance sold to a customer | Organization |
| Package Credits / Ledger | Immutable credit movements | Organization |
| Expiration / Gift / Adjustment | Policy + ledger reasons | Organization |

See [package-ledger.md](./package-ledger.md).

---

## 7. STORED VALUE

| Domain | Description | Owner |
|--------|-------------|-------|
| Customer Stored Value | Derived balance | Organization |
| Stored Value Ledger | Immutable movements | Organization |

See [package-ledger.md](./package-ledger.md#stored-value).

---

## 8. CHECKOUT

| Domain | Description | Owner |
|--------|-------------|-------|
| Transactions | Commercial sale header | Organization + Location |
| Transaction Items | Line items (service/package/product/custom) | Same |
| Payments | Tender lines (cash/card/stored value/…) | Same |
| Discounts / Refunds | Adjustments & reversals | Same |

**Treatment ≠ Transaction.** See [checkout.md](./checkout.md).

---

## 9. PRODUCT & INVENTORY

| Domain | Description | Owner | Horizon |
|--------|-------------|-------|---------|
| Products | Retail SKUs | Organization | NEXT |
| Product Sales | Via TransactionItem | Org + Location | NEXT |
| Inventory / Stock | Qty by location | Org + Location | LATER |
| Inventory Movements | Receipts, waste, transfer | Org + Location | LATER |

---

## 10. CRM

| Domain | Description | Owner | Horizon |
|--------|-------------|-------|---------|
| Follow Ups | Tasks from treatment / marketing | Organization | MVP CORE (basic) |
| Customer Segments | Lists / filters | Organization | NEXT |
| Reminders | Callback / birthday / dormant | Organization | NEXT |
| Rebooking Tasks | Suggested next booking | Organization | MVP CORE (basic) |

---

## 11. REPORTING

| Domain | Description | Owner | Horizon |
|--------|-------------|-------|---------|
| Revenue | From transactions | Org (+ location filter) | NEXT |
| Appointments | Utilization / no-show | Org + Location | NEXT |
| Retention | Visit cadence | Organization | NEXT |
| Staff / Service performance | Aggregates | Org + Location | NEXT |

Reports read other domains; they are not a write source of truth.

---

## 12. STAFF

| Domain | Description | Owner |
|--------|-------------|-------|
| Staff Profiles | Display identity | User + Membership |
| Roles | OWNER / MANAGER / STAFF / RECEPTIONIST / … | Organization |
| Permissions | Fine-grained keys | Organization (role → permissions) |
| Location Access | `locationIds` on membership | Organization |

See [rbac.md](./rbac.md).

---

## 13. SAAS PLATFORM

| Domain | Description | Owner |
|--------|-------------|-------|
| Plans | TRIAL / STARTER / PRO / BUSINESS | Platform |
| Subscriptions | Org’s plan status | Platform ↔ Org link |
| Entitlements | Feature/limit flags | Platform |
| Usage | Metering | Platform |
| Billing | Invoices / payment to Beauty OS | Platform |
| Platform Admin | Operator tooling | Platform |

See [platform-admin.md](./platform-admin.md) and [entitlements.md](./entitlements.md).

---

## Relationship sketch

```text
Organization
├── Locations
├── StaffMemberships → Users
├── Customers ──┬── Consultations
│               ├── Notes / Tags / Photos
│               ├── CustomerPackages → PackageLedger
│               └── StoredValueLedger
├── Services → (serviceType → Platform TreatmentTemplate)
├── Appointments (locationId) → Treatments (optional locationId)
├── Packages (catalog)
├── Products (catalog)
└── Transactions (locationId) → Items + Payments
         ↑ may redeem package / stored value
         ↑ may reference appointment / treatment
```
