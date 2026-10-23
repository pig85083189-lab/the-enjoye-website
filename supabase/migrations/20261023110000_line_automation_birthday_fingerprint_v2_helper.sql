-- Phase 3: additive birthday occurrence identity helper.
-- Deliberately does not alter the live schedule RPC or existing rows.
-- A subsequent coordinated migration must update validation, cancellation,
-- update-path canonical identity and planner before annual jobs are enabled.
-- No outbound send, cron, or existing broadcast objects are modified.

create or replace function public.line_automation_birthday_fingerprint_v2(
  p_organization_id text,
  p_customer_id text,
  p_timing_id text,
  p_occurrence_date date
)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_organization_id is null or p_organization_id not like 'org-%'
    or nullif(btrim(p_customer_id), '') is null
    or p_timing_id not in ('birthday_morning', 'days_before_3')
    or p_occurrence_date is null
  then
    raise exception 'invalid birthday fingerprint input' using errcode = '22023';
  end if;
  return p_organization_id || '|birthday_greeting|' || p_customer_id || '|' ||
    p_timing_id || '|' || extract(year from p_occurrence_date)::int::text;
end;
$$;

comment on function public.line_automation_birthday_fingerprint_v2(text, text, text, date) is
  'Phase 3 birthday occurrence-year identity helper. Not yet wired into schedule apply; does not send LINE.';

revoke all on function public.line_automation_birthday_fingerprint_v2(text, text, text, date) from public, anon, authenticated;
