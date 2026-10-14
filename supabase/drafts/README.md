# LINE appointment reminder drafts

These SQL files are **not** part of the published `supabase/migrations/` chain.

Rules:

- Do not apply these drafts to Production.
- Do not copy them into `supabase/migrations/` until Owner confirms.
- `lib/persistence/fresh-migration-chain.isolation.test.ts` must keep expecting the current published chain. Drafts here must not appear in that list.
- Phase 2E-10A applied `20261014180000_line_owner_self_reminder_grant.sql` once to Preview `bfzquejrtgqzzarhkiya` (SHA-256 `fde24612e6ab1de1678430f61edc5e40aaeb9a1cb05cebadf3f8ef24c10abffb`). Do not blindly re-run it. Do not write `schema_migrations`.
- Phase 2E-10B armed Preview runtime identity after Management API project-ref verification. Do not arm Production. Grant/oneshot persist is Owner-triggered only. SEND stays closed.

Current drafts:

- `20261013120000_line_appointment_reminder_automation.sql` — Phase 2A/2B reminder tables (historical copy; a later published migration may already exist).
- `20261014180000_line_owner_self_reminder_grant.sql` — Phase 2E-10A Preview structure installed, unpublished. Fail-closed identity row remains empty. Not armed. Trusted service-role quota snapshots only. Same Channel lock as Broadcast. Never calls LINE.
