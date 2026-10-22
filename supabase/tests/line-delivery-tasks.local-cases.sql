-- Local-only assertions for LINE delivery tasks.
-- Never connect to Preview or Production. Never call LINE.

do $$
declare
  v_hash text;
begin
  v_hash := encode(sha256(convert_to('Udddddddddddddddddddddddddddddddd', 'utf8')), 'hex');
  insert into public.line_customer_bindings (
    id, organization_id, customer_id, customer_uuid,
    line_user_id_hint, line_user_id_hash, bind_method,
    verified, status, captured_at, bound_at, confirmed_at, confirmed_by,
    pending_expires_at
  )
  values (
    'lcb-delivery-cust-2', 'org-the-enjoye', 'cust-2',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '••••dddd', v_hash, 'webhook_code',
    true, 'active', now(), now(), now(), 'staff-enjoye-owner',
    null
  )
  on conflict (id) do nothing;

  insert into public.line_customer_binding_secrets (
    binding_id, organization_id, line_user_id_cipher, key_id
  )
  values (
    'lcb-delivery-cust-2', 'org-the-enjoye', 'v1.cipher-delivery-cust-2', 'line-cred-v1'
  )
  on conflict (binding_id) do nothing;
end $$;
