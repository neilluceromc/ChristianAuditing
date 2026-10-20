-- Cloud staging (spec §4.2): close Supabase's auto-generated Data API over the public schema.
--
-- The app reaches Postgres only through Prisma, as the `postgres` role. The `anon` and `authenticated`
-- roles (what the public anon key and Supabase Auth users act as) need nothing in `public`, so this
-- takes everything away from them: today's tables, sequences and functions, and, through default
-- privileges, every one created later by `postgres` (the role the restore and `prisma migrate deploy`
-- run as). `service_role` is left alone; it is server-only and Storage uses it.
--
-- RUN IT TWICE, in the Supabase SQL editor (Project -> SQL Editor -> New query -> paste -> Run):
--   1. once on the empty project, BEFORE the restore (after turning the Data API off);
--   2. again AFTER the restore, so the revoke also covers the restored tables.
-- It is idempotent: running it again changes nothing and never errors.
--
-- Check afterwards (expect zero rows):
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated');

begin;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

commit;
