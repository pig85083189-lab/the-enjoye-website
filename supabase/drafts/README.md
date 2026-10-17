# Unpublished SQL drafts

These files are **not** migrations. Do not copy them into `supabase/migrations/`.
Do not apply them to Preview or Production until Owner explicitly approves that step.

| File | Scope | Applied? |
| --- | --- | --- |
| `20261016120000_line_owner_self_reminder_grant_production.sql` | Production THE ENJOYE Owner-self grant / oneshot / quota. Phase 2F-1 draft only. | No |
| `PHASE_2F2_READONLY_FINDINGS.md` | Phase 2F-2 read-only webhook / bind / SQL verification. | N/A |
| `PHASE_2F3_WEBHOOK_CUTOVER_PLAN.md` | Phase 2F-3 cutover / rollback plan. Webhook URL not changed. | N/A |
| Phase 2F-4 | Enjoye Owner bind-start UI prep. Issue/bind stay closed. | N/A |
| `PHASE_2F5_SHARED_WEBHOOK_ROUTING.md` | Phase 2F-5 shared-channel routing prototype. Not wired to a real URL. | N/A |

Phase 2F-1 does not arm Production, does not insert grant/oneshot rows on Preview or Production, and does not call LINE.

Local review only: `scripts/line-owner-self-reminder-grant-production-local-pg.sh` applies this draft to a disposable unix-socket database named `beauty_os_line_2f1_local`, then drops it.
