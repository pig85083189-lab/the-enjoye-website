# Migration repair: 20260928113000_beauty_os_operational_foundation.sql

Phase 1C-6H.2P2B. Controlled published-migration corrective repair.

## Reason

`published migration was not replayable on fresh PostgreSQL 16`

Fresh-chain proof (Phase 1C-6H.2P2A): after the additive
`20260928112975` bridge removed the `audit_logs_insert_org` type-alter
blocker and provided `public.min(uuid)`, immutable `113000` still failed
creating `audit_logs_insert_org`:

```
ERROR: operator does not exist: uuid = text
```

Innermost `FROM public.staff_auth_memberships` shadows unqualified
`organization_id` / `actor_id` as text app_id / staff id. The outer
`audit_logs` columns are uuid / text after conversion; `o.id = organization_id`
became `uuid = text`.

This is not safely fixable with another pre-113000 bridge without a
global `uuid = text` operator (forbidden).

## Hashes

| State | SHA256 |
|---|---|
| Defective (origin/main, restored by `9a99aa4`) | `2c01751cdbcef8294d16b0cb580c17948ce9598528bb0e7ca4dada0ff1a24618` |
| Corrected replay (this repair) | `baa230a5f4aa44d506aa811e3350cbf39265ce56d1083aba56a1c8ace65911f5` |

Git blob: defective `37e5a2225370f40707240a6551e4ce13161f6500` →
corrected `c03928caf5c3b3f9a057df4536abf4b25b0be518`.

## Exact SQL diff

Only `create policy audit_logs_insert_org` qualification. No type
changes, no RLS disable, no operator/cast hacks, no table drops.

```diff
-    public.user_has_org_membership(organization_id)
+    public.user_has_org_membership(audit_logs.organization_id)
-      actor_id is null
+      audit_logs.actor_id is null
-        where o.id = organization_id
+        where o.id = audit_logs.organization_id
-          and m.user_id = actor_id
+          and m.user_id = audit_logs.actor_id
```

## Environments

| Environment | Applied defective main 113000? | Notes |
|---|---|---|
| Preview `bfzquejrtgqzzarhkiya` | No | Applied rewritten 113000 on 2026-10-01 (`b436d07` qualified policies / count-gated helper). `schema_migrations` records `20260928113000`. Do **not** replay this repair onto Preview history. |
| Production `knccefcxncglgpmvgqlp` | No | Stopped after `112950`. No Production drift. |
| origin/main file (git) | Defective text | Restored by `9a99aa4` to keep published SQL immutable. Replay later proved that text unapplyable. |

## Final schema equivalence

`20261006120000_strategy_b_rls_qualification.sql` recreates
`audit_logs_insert_org` with the same qualified outer columns and
replaces `current_organization_id()` with the count-gated scalar.
A fresh DB that applies corrected 113000 + Strategy B matches the
Preview *intended* final policy / helper. Preview live
`current_organization_id` is already the Strategy B body.

## Governance

- Do not rewrite other published migrations.
- Do not re-apply `113000` to Preview (already in remote history).
- Future edits to this file must update this document and the
  `migration-repair-113000` contract test.
- `min(uuid)` compile gap stays on the additive `112975` bridge;
  this repair does not change `current_organization_id()` in 113000.
