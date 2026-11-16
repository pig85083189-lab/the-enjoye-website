-- Read-only catalog export for the objects PR #84 replaces.
-- Run on the finance database with: psql -v catalog=finance -f this file
-- Run on the booking database with: psql -v catalog=booking -f this file
-- Output is function, trigger, and privilege SQL only. It does not select
-- customers, bindings, ledger rows, receipts, or credentials.
-- Each row is one complete SQL statement. This file does not write.

SELECT stmt
FROM (
    SELECT
      10 AS ord,
      p.oid::regprocedure::text AS name,
      pg_get_functiondef(p.oid) || E';\n' AS stmt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = ANY (
        CASE :'catalog'
          WHEN 'finance' THEN ARRAY[
            'settle_booking_source_checkout(text,text,text,text,bigint,text)',
            'post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)'
          ]::text[]
          WHEN 'booking' THEN ARRAY[
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb)',
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb,jsonb)',
            'settle_checkout_draft(text,timestamp with time zone)'
          ]::text[]
          ELSE ARRAY[]::text[]
        END
      )

    UNION ALL

    SELECT
      20,
      p.oid::regprocedure::text,
      format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;',
        p.oid::regprocedure
      )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = ANY (
        CASE :'catalog'
          WHEN 'finance' THEN ARRAY[
            'settle_booking_source_checkout(text,text,text,text,bigint,text)',
            'post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)'
          ]::text[]
          WHEN 'booking' THEN ARRAY[
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb)',
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb,jsonb)',
            'settle_checkout_draft(text,timestamp with time zone)'
          ]::text[]
          ELSE ARRAY[]::text[]
        END
      )

    UNION ALL

    SELECT
      30,
      p.oid::regprocedure::text || ':' || coalesce(r.rolname, 'public'),
      format(
        'GRANT EXECUTE ON FUNCTION %s TO %s;',
        p.oid::regprocedure,
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
      )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public'
      AND a.privilege_type = 'EXECUTE'
      AND p.oid::regprocedure::text = ANY (
        CASE :'catalog'
          WHEN 'finance' THEN ARRAY[
            'settle_booking_source_checkout(text,text,text,text,bigint,text)',
            'post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)'
          ]::text[]
          WHEN 'booking' THEN ARRAY[
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb)',
            'save_checkout_draft(text,timestamp with time zone,jsonb,jsonb,jsonb)',
            'settle_checkout_draft(text,timestamp with time zone)'
          ]::text[]
          ELSE ARRAY[]::text[]
        END
      )

    UNION ALL

    SELECT
      40,
      t.tgname,
      format(
        'DROP TRIGGER IF EXISTS %I ON public.stored_value_ledger_entries;',
        t.tgname
      ) || E'\n' || pg_get_triggerdef(t.oid, true) || ';'
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE :'catalog' = 'finance'
      AND n.nspname = 'public'
      AND c.relname = 'stored_value_ledger_entries'
      AND t.tgname = 'trg_stored_value_ledger_immutable'
      AND NOT t.tgisinternal

    UNION ALL

    SELECT
      50,
      'stored_value_debit_receipts',
      'REVOKE ALL ON TABLE public.stored_value_debit_receipts FROM PUBLIC, anon, authenticated, service_role;'
    WHERE :'catalog' = 'booking'
      AND to_regclass('public.stored_value_debit_receipts') IS NOT NULL

    UNION ALL

    SELECT
      60,
      'stored_value_debit_receipts:' || coalesce(r.rolname, 'public'),
      format(
        'GRANT %s ON TABLE public.stored_value_debit_receipts TO %s;',
        a.privilege_type,
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
      )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE :'catalog' = 'booking'
      AND n.nspname = 'public'
      AND c.relname = 'stored_value_debit_receipts'
) exported
ORDER BY ord, name;
