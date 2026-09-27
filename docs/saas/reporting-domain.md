# Reporting Domain

**Phase 4.11D** · Staff Ops Dashboard  
**Prerequisite:** Phase 4.11C Follow-ups · Core commerce / appointments / treatments

## Principle

**Reports = read-only derived data.**

Do **not** persist report rows as business source of truth.  
Do **not** create report revenue / appointment / customer stores.

All numbers come from existing canonical stores:

| Metric family | Canonical source | Date field |
|---------------|------------------|------------|
| Revenue / payments / sales mix | `Transaction` (COMPLETED) | `completedAt` |
| Appointments | `ScheduleAppointment` | `startAt` |
| Treatments | completed treatment repository + open drafts | `updatedAt` (completed) |
| Follow-ups | `FollowUpTask` | open/overdue = current; completed = `completedAt` |
| Paying customers | distinct `customerId` on revenue txs | via TX `completedAt` |

## Timezone

Prototype uses **browser local** calendar boundaries (`startOfDay` / `endOfDay`).  
There is no Organization timezone yet — do not assume UTC day cuts.

## Location filter

| Domain | Rule |
|--------|------|
| Transaction | `transaction.locationId` |
| Appointment | `appointment.locationId` |
| Treatment | filter when `locationId` present; optional location still included |
| Follow-up | filter when `locationId` present |
| Customer identity / package SV **balances** | organization-wide (not relocated by UI) |

Never rewrite historical activity location from the current UI location switcher.

## Revenue definition (ops, not accounting)

- **Include:** `Transaction.status === COMPLETED` → sum `total`
- **Exclude:** `VOIDED`
- **Zero-total** (e.g. package redemption): not revenue; excluded from transaction count / AOV
- **Not revenue sources:** Appointment COMPLETED, Treatment COMPLETED

Average ticket = `revenueMinor / transactionCount` (paid COMPLETED only), else `0` (never NaN).

### Package / Stored value semantics

| Kind | Ops treatment |
|------|----------------|
| SERVICE / PRODUCT line totals | Sales mix |
| PACKAGE_PURCHASE / STORED_VALUE_TOP_UP line totals | Shown separately (prepaid / liability semantics) — **not** mixed into service/product mix |
| STORED_VALUE **payment** | Tender breakdown only |
| Package redemption zero-total TX | Not revenue |

UI label: **營運報表** — not a formal accounting / financial statement.

## Appointment rates

Denominator = non-`DRAFT` appointments with `startAt` in range.  
Rates: completed | cancelled | no-show ÷ denominator.

## Follow-up rates

Denominator (snapshot) = open (not overdue) + overdue + completed-in-range.  
Open/overdue reflect **current** task state (not historical as-of).

## Customer metrics

v1: **paying customer count** only (distinct customers with COMPLETED total > 0).  
New vs returning **not** reported — first-visit history is not reliable enough in prototype seeds.

## API surface

`lib/reports/` — selectors / aggregators / date helpers only.  
Orchestrator: `getOpsDashboardReport(query)`.

## Non-goals

Export / PDF · AI analytics · Notifications · formal GL · refund analytics
