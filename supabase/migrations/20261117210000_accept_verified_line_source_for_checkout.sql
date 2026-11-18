-- Allow the existing staff-verified LINE source-link flow to be used by checkout.
-- Previously link_booking_source_from_verified_line wrote LINE_VERIFIED_SESSION,
-- while resolve_booking_source_customer accepted only legacy evidence kinds.
-- Do not create any links here. Existing customer, wallet and ledger rows stay unchanged.
create or replace function public.resolve_booking_source_customer(
  p_organization_id uuid, p_source_customer_key text
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_booking uuid;
begin
  select link_row.finance_booking_customer_id into v_booking
  from public.booking_source_customer_links link_row
  where link_row.organization_id = p_organization_id
    and link_row.source_customer_key = btrim(p_source_customer_key)
    and link_row.status = 'ACTIVE'
    and link_row.revoked_at is null
    and link_row.evidence_kind in (
      'CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD', 'LINE_VERIFIED_SESSION'
    )
  for update;
  if v_booking is null then
    raise exception '必須先完成顧客身分對應';
  end if;
  return v_booking;
end;
$$;
