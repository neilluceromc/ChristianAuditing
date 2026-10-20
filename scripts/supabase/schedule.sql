-- Cloud staging (spec §4.3): Supabase pg_cron + pg_net call the app's worker routes.
--
--   worker-tick         every minute   POST <app_url>/api/worker/tick
--   worker-maintenance  hourly at :05  POST <app_url>/api/worker/maintenance
--
-- Both send `Authorization: Bearer <cron_secret>`. The secret and the address live in Supabase Vault,
-- never in this file. Run AFTER the first Vercel production deploy.
--
-- STEP 1 (once, in the SQL editor; replace the two placeholders, keep the names exactly):
--   select vault.create_secret('https://<project>.vercel.app', 'app_url');      -- no trailing slash
--   select vault.create_secret('<your-cron-secret>', 'cron_secret');           -- the same value as Vercel's CRON_SECRET
-- To change one later: Project -> Integrations -> Vault (or vault.update_secret(id, new_secret)).
--
-- STEP 2: run this whole file. It unschedules both jobs first, so it can be re-run safely.
--
-- Check:
--   select jobname, schedule, active from cron.job;                                -- the two jobs
--   select status, succeeded, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, created from net._http_response order by created desc limit 5;  -- expect 200
-- A 401 there means Vault's cron_secret and Vercel's CRON_SECRET differ.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('worker-tick', 'worker-maintenance');

select cron.schedule('worker-tick', '* * * * *', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='app_url') || '/api/worker/tick', headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds := 60000) $$);

select cron.schedule('worker-maintenance', '5 * * * *', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='app_url') || '/api/worker/maintenance', headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')), timeout_milliseconds := 60000) $$);
