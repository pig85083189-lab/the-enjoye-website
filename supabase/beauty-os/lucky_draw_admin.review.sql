-- Booking project only. Review and test before applying.
begin;
create table public.lucky_draw_campaign_drafts (
  organization_id uuid primary key references public.organizations(id),
  name text not null check (length(btrim(name)) between 1 and 200),
  starts_on date,
  ends_on date,
  rules jsonb not null default '{"spend":{"enabled":true,"amountMinor":1000},"points":{"enabled":true,"pointsPerDraw":100},"treatment":{"enabled":true,"drawsPerTreatment":1},"birthday":{"enabled":true,"drawsPerYear":3},"manual":{"enabled":true}}'::jsonb,
  prizes jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status = 'draft'),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (jsonb_typeof(rules) = 'object'),
  check (jsonb_typeof(prizes) = 'array')
);
alter table public.lucky_draw_campaign_drafts enable row level security;
revoke all on public.lucky_draw_campaign_drafts from public, anon, authenticated;
grant select, insert, update on public.lucky_draw_campaign_drafts to authenticated;
create policy lucky_draw_draft_select on public.lucky_draw_campaign_drafts for select to authenticated
using (public.user_has_org_membership(organization_id) and public.staff_role_is_managerial(public.user_org_role(organization_id)));
create policy lucky_draw_draft_insert on public.lucky_draw_campaign_drafts for insert to authenticated
with check (public.user_has_org_membership(organization_id) and public.staff_role_is_managerial(public.user_org_role(organization_id)));
create policy lucky_draw_draft_update on public.lucky_draw_campaign_drafts for update to authenticated
using (public.user_has_org_membership(organization_id) and public.staff_role_is_managerial(public.user_org_role(organization_id)))
with check (public.user_has_org_membership(organization_id) and public.staff_role_is_managerial(public.user_org_role(organization_id)));
-- Draft data is never a source of live draw probabilities or credits.
-- Publication requires a separate validated, versioned configuration transaction.
commit;
