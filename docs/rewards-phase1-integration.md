# THE ENJOYE Rewards C: Phase 1 integration contract (TEST ONLY)

## Status
Design draft committed to a development branch only. No Supabase migration executed. No customer wallet created and no real balance changed.

## Boundary
Beauty OS staff and THE ENJOYE member web will use server-side API endpoints that verify authenticated identity and organization/location membership. They must not write wallet balances directly from browser clients. Keep reward tables in a private schema without grants to anon/authenticated. Never expose service keys to Next.js client.

## Identity
A LINE session is not sufficient to claim an existing Beauty OS customer. Resolve only a verified member-customer binding on the server, or create a distinct provisional account after explicit registration. Block checkout redemption and historical rewards until binding is verified. Inspect the actual customer ID column types and relationships before running the schema.

## Coin rules
Store integer coins. Wallet is a materialized balance; immutable ledger is the audit source. All earn/spend/reverse operations must be one DB transaction with row lock, idempotency key, and organization checks. Do not trust browser-provided balances, prices, discounts or customer IDs.

## C redemption
- Direct discount: server quotes amount, checks max percent, rounding and coupon stacking rules; reserve coins atomically; commit only after authoritative checkout success, otherwise reverse.
- Coupon/gift: server checks active catalog, validity, per-member limits and inventory, debits coins and creates entitlement atomically.
- Refund: append compensating ledger entry; do not delete historical transactions.
- Pet hearts and member coins are separate assets.

## Acceptance gates
1. Match customer IDs and tenant schema on isolated TEST.
2. Verify RLS/grants and no public write path.
3. Run concurrent spend, replay, insufficient balance, cross-tenant, unverified LINE, duplicate task, refund and coupon double-use tests.
4. Add staff management and member wallet read APIs, then stage with fake data.
5. Only after signoff decide production migration and enablement.

## Relevant code
- Beauty OS: `app/staff/(app)/rewards/page.tsx` currently preview-only.
- Member web: `app/member/pet/page.tsx` currently preview-only.
- Proposed schema: `supabase/rewards/rewards_phase1_review.sql`.
