# Entity Ownership Matrix

Phase 4.6. Ownership answers: who **owns** the record, and whether it is **location-scoped**.

## Legend

| Code | Meaning |
|------|---------|
| **P** | Platform-owned |
| **O** | Organization-owned (tenant root) |
| **O+L** | Organization-owned **and** Location-scoped (location required for ops) |
| **O~L** | Organization-owned; Location optional / linked |
| **U** | User identity (Auth) |

---

## Matrix

| Entity | Ownership | Notes |
|--------|-----------|-------|
| PlatformAccount / PlatformAdmin | **P** | Separate from org roles |
| Plan / EntitlementDefinition | **P** | Catalog of SaaS capabilities |
| Organization | **P** creates · **O** profile | Tenant root |
| OrganizationSubscription | **P** + org link | Billing relationship |
| Location | **O** | Always `organization_id` |
| User | **U** / **P** Auth | Global login identity |
| StaffMembership | **O** | `user_id` + `organization_id` + `location_ids` + role |
| Customer | **O** | Shared across locations of the brand |
| CustomerConsultation | **O** | Versioned; never overwrite history |
| CustomerNote / Tag | **O** | Internal CRM |
| CustomerPhoto (CRM) | **O~L** | Optional location / treatment refs |
| Service / ServiceCategory | **O** | Menu belongs to brand |
| TreatmentTemplate | **P** | Platform UX recipes by `serviceType` |
| Appointment | **O+L** | Happens at a store |
| AppointmentStatusHistory | **O+L** | Audit of appointment transitions |
| Treatment / TreatmentDraft | **O~L** | Prefer location when from appointment |
| TreatmentPhoto | **O~L** | Storage path under org |
| Package (catalog) | **O** | Sellable bundle definition |
| CustomerPackage | **O** | Sold instance for a customer |
| PackageLedgerEntry | **O** | Immutable credit movement |
| StoredValueLedgerEntry | **O** | Immutable wallet movement |
| Transaction | **O+L** | Sale at a store |
| TransactionItem | **O+L** | Child of transaction |
| Payment | **O+L** | Tender line(s) |
| Product | **O** | Retail catalog |
| InventoryStock | **O+L** | Qty per location |
| InventoryMovement | **O+L** | Stock event |
| FollowUp / RebookingTask | **O~L** | May prefer a location |
| Report aggregates | derived | Filters by org ± location |
| AuditLog | **O** or **P** | Scope depends on actor domain |

---

## Key decisions

### 1. Customer = Organization-wide

Same guest visiting 台中店 and 台北店 under THE ENJOYE = **one Customer**.

- Avoid duplicate phones / CRM fragmentation.
- Appointments and transactions still record **which location** served them.

### 2. Appointment / Transaction / Inventory = Location-scoped

These are physical-ops events. Always carry `location_id` (non-null in production design).

### 3. Treatment = Organization-owned, Location optional

- From Today/appointment flow: copy `location_id` from appointment.
- Historical / imported records may have null location until backfilled.
- Never use location alone as tenant boundary.

### 4. Packages & stored value = Organization-wide balances

Credits and wallet belong to the **customer within the organization**, redeemable at any location of that org (policy may later restrict — entitlement/settings, not ownership change).

### 5. Platform vs Organization

| Platform | Organization |
|----------|--------------|
| Plans, billing of Beauty OS | Customers, appointments, treatments |
| Platform Admin users | StaffMemberships |
| Feature entitlement definitions | Org settings, locations, services |

---

## Anti-patterns to avoid

- Putting `location_id` on Customer as **required** ownership (fragments identity).
- Using Platform Admin login as org OWNER.
- Storing `remainingSessions` without a ledger.
- Merging Treatment and Transaction into one table.
- Trusting client `organizationId` without membership / future RLS.
