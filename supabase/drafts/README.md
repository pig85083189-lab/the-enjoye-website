# LINE appointment reminder drafts

These SQL files are **not** part of the published `supabase/migrations/` chain.

Phase 2A rules:

- Do not apply this draft to Preview or Production.
- Do not copy it into `supabase/migrations/` until Owner confirms.
- `lib/persistence/fresh-migration-chain.isolation.test.ts` must keep expecting the current exact chain ending at `20261012120000_line_broadcast_channel_lock.sql`.
