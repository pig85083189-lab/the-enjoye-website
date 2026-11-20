-- Review only. Do not run this against production until the read-only
-- preflight has been checked and a finance backup has been verified.
-- This file is not in supabase/migrations.
-- It creates a private bucket. It does not delete customers, treatments,
-- appointments, wallets, or publication rows.
-- Anonymous and authenticated clients receive no access.
-- The application uploads and downloads with the finance service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-treatment-photos',
  'member-treatment-photos',
  false,
  1500000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- No public read policy is created. A missing policy denies anonymous reads.
