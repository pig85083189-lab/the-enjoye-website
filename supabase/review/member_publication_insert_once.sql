-- Review only. This file is not in supabase/migrations and is not applied
-- to production by this pull request.
-- Automatic member publication is insert-once.
-- A conflicting treatment_id does nothing, so a revoked row cannot be revived.

create unique index if not exists member_treatment_publications_treatment_id_key
  on public.member_treatment_publications (treatment_id);

create or replace function public.insert_member_treatment_publication_once(
  p_treatment_id uuid,
  p_organization_id uuid,
  p_customer_id uuid,
  p_approved_fields jsonb,
  p_approved_by uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.member_treatment_publications%rowtype;
begin
  insert into public.member_treatment_publications (
    treatment_id, organization_id, customer_id, approved_fields,
    approved_by, approved_at, revoked_at, updated_at
  ) values (
    p_treatment_id, p_organization_id, p_customer_id, p_approved_fields,
    p_approved_by, now(), null, now()
  )
  on conflict (treatment_id) do nothing
  returning * into existing;

  if found then
    return 'inserted';
  end if;

  select * into existing
  from public.member_treatment_publications
  where treatment_id = p_treatment_id
    and organization_id = p_organization_id;

  if existing.treatment_id is null then
    return 'failed';
  end if;
  if existing.revoked_at is not null then
    return 'revoked';
  end if;
  if existing.customer_id is distinct from p_customer_id
     or existing.approved_fields is distinct from p_approved_fields then
    return 'mismatch';
  end if;
  return 'already';
end;
$$;

revoke all on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid)
  to service_role;

comment on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid) is
  'Insert a member publication once. Conflict does not update, and a revoked row stays revoked.';
