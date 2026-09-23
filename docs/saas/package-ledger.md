# Package Ledger

Phase **4.9B** runtime (localStorage). Balances are **derived** from immutable ledger entries.

**Never** store `remainingSessions` as canonical mutable truth.

---

## PackageDefinition (catalog)

`organizationId` · `name` · `includedServices[]` (`serviceId`, `sessionsPerRedemption: 1`) · `sessionCount` · `priceMinor` · `currency` · `validityDays?` · `isActive`

Management UI: `/staff/packages` (create / edit / deactivate — no hard delete).

---

## CustomerPackage (instance)

Created only after a **COMPLETED** Transaction with a `PACKAGE_PURCHASE` item.

Snapshots at purchase: `nameSnapshot` · `sessionCountSnapshot` · `priceSnapshot` · `includedServiceIdsSnapshot`

Status: `ACTIVE` | `EXHAUSTED` | `EXPIRED` | `VOIDED` (UI/helper; balance still from ledger).

---

## PackageLedgerEntry (immutable)

Types: `PURCHASE` (+N) · `REDEMPTION` (−1) · `ADJUSTMENT` (±N, reason required) · `REVERSAL` (inverse)

Fields include `locationId` (activity location), `transactionId`, `serviceId`, `appointmentId?`, `effectKey` (idempotency).

**No edit / hard delete.** Corrections = new REVERSAL or ADJUSTMENT.

---

## Balance

```text
ledgerBalance = SUM(sessionDelta)
usableBalance = expired or VOIDED ? 0 : max(0, ledgerBalance)
```

Org-wide balance; redemption may occur at any location in the same organization. Each entry records `locationId`.

---

## Purchase / redemption timing

| Moment | Effect |
|--------|--------|
| OPEN CheckoutDraft + select package | **No** ledger write |
| Failed settle | **No** ledger write |
| COMPLETED Transaction | PURCHASE / REDEMPTION via `applyCommerceLedgerEffects` |

Idempotency: `effectKey = {transactionId}:PACKAGE_PURCHASE|{REDEMPTION}:{sourceId}`

---

## Reversal

`reversePackageLedgerEntry` appends inverse entry once (`already reversed` if repeated).

---

## Future Supabase

`package_definitions` · `customer_packages` · `package_ledger_entries` with RLS on `organization_id`. RPC for atomic settle.
