create table if not exists public.member_home_theme (
 organization_id uuid primary key references public.organizations(id),
 config jsonb not null default '{}'::jsonb check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now()
);
alter table public.member_home_theme enable row level security;
revoke all on public.member_home_theme from public,anon,authenticated;
grant select,insert,update on public.member_home_theme to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('member-home-assets','member-home-assets',true,3500000,array['image/jpeg','image/png','image/webp','image/gif','video/mp4']) on conflict(id) do nothing;