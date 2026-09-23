# Supabase (Phase 3B)

Migrations live in `migrations/`.

## Apply to remote (when ready)

Requires your local Supabase CLI login / project link.  
**Do not** commit database passwords or `service_role` keys.

```bash
npx supabase login
npx supabase init   # if you need a full config.toml
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste `migrations/20260918120000_beauty_os_foundation.sql` into the Supabase Dashboard SQL editor.

Phase 3B ships the migration in this repository only; the Next.js app does **not** auto-apply it.
