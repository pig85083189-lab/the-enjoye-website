create table public.member_card_theme (
 organization_id uuid primary key references public.organizations(id),
 theme text not null default 'gold' check(theme in ('gold','rose','cocoa'))
);
alter table public.member_card_theme enable row level security;
revoke all on public.member_card_theme from public,anon,authenticated;
grant select,insert,update on public.member_card_theme to service_role;
