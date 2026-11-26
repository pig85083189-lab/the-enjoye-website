alter table public.member_points_banner add column slides jsonb;
alter table public.member_points_banner add constraint member_points_banner_slides_check check (slides is null or (jsonb_typeof(slides)='array' and jsonb_array_length(slides)<=10));
update public.member_points_banner set slides=case when image_url is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('image_url',image_url,'href','','enabled',true)) end;
