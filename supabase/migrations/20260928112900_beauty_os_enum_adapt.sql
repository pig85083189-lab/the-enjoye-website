-- =============================================================================
-- Beauty OS — Phase 5A-1 enum ADAPT (must commit before operational tables)
-- Migration: 20260928112900_beauty_os_enum_adapt.sql
--
-- PostgreSQL cannot use a newly added enum value in the same transaction.
-- This file only ADDs values. 20260928113000 may default columns to STAFF.
--
-- ADAPT (not a second role system):
--   Phase 3B staff_role: OWNER, MANAGER, THERAPIST, RECEPTIONIST
--   App-canonical:       OWNER, MANAGER, STAFF
--   THERAPIST ≡ STAFF (keep THERAPIST; add STAFF / ACCOUNTANT)
--   appointment_status: add DRAFT (app creates drafts before BOOKED)
-- =============================================================================

alter type public.staff_role add value if not exists 'STAFF';
alter type public.staff_role add value if not exists 'ACCOUNTANT';

alter type public.appointment_status add value if not exists 'DRAFT';
