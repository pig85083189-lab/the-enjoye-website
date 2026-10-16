# Unpublished SQL drafts

These files are **not** migrations. Do not copy them into `supabase/migrations/`.
Do not apply them to Preview or Production until Owner explicitly approves that step.

| File | Scope | Applied? |
| --- | --- | --- |
| `20261016120000_line_owner_self_reminder_grant_production.sql` | Production THE ENJOYE Owner-self grant / oneshot / quota. Phase 2F-1 draft only. | No |

Phase 2F-1 does not arm Production, does not insert grant/oneshot rows on Preview or Production, and does not call LINE.

Local review only: `scripts/line-owner-self-reminder-grant-production-local-pg.sh` applies this draft to a disposable unix-socket database named `beauty_os_line_2f1_local`, then drops it.
