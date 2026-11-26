create table if not exists public.member_pet_settings (organization_id uuid primary key references public.organizations(id), pets jsonb not null default '[]'::jsonb check(jsonb_typeof(pets)='array' and jsonb_array_length(pets)<=30), active_id text, updated_at timestamptz not null default now());
alter table public.member_pet_settings enable row level security;
revoke all on public.member_pet_settings from public,anon,authenticated;
grant select,insert,update on public.member_pet_settings to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('member-pet-assets','member-pet-assets',true,3500000,array['image/gif','image/png','image/jpeg','image/webp']) on conflict(id) do nothing;