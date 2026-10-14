# LINE appointment reminder drafts

These SQL files are **not** part of the published `supabase/migrations/` chain.

Rules:

- Do not apply these drafts to Preview or Production.
- Do not copy them into `supabase/migrations/` until Owner confirms.
- `lib/persistence/fresh-migration-chain.isolation.test.ts` must keep expecting the current published chain. Drafts here must not appear in that list.

Current drafts:

- `20261013120000_line_appointment_reminder_automation.sql` — Phase 2A/2B reminder tables (historical copy; a later published migration may already exist).
- `20261014180000_line_owner_self_reminder_grant.sql` — Phase 2E-9 Preview-ready Owner-self grant. Fail-closed Preview identity row (never inserted by the draft). PostgreSQL cannot discover the live project ref. Trusted service-role quota snapshots only. Same Channel lock as Broadcast. Never calls LINE.
