create table public.member_points_banner (
 organization_id uuid primary key references public.organizations(id),
 image_url text,
 title text not null default '寵愛好禮・點數兌換' check(char_length(title)<=120),
 subtitle text not null default '讓每一次保養，累積更多美好' check(char_length(subtitle)<=200),
 show_text boolean not null default true,
 enabled boolean not null default true
);
alter table public.member_points_banner enable row level security;
revoke all on public.member_points_banner from public,anon,authenticated;
grant select,insert,update on public.member_points_banner to service_role;
