-- Optional deployment recipe, not an automatically applied migration.
-- Requires Supabase Cron, pg_net and Vault enabled via the Dashboard.
-- Store the API base URL (without a trailing slash) as Vault secret dream_piggy_api_url,
-- and the existing backend CRON_SECRET as dream_piggy_cron_secret.
-- No provider API key belongs in this job or in browser code.
-- Schedule matches the default 5-minute provider interval. The shared backend budget
-- and cache still apply if another worker or a connected client checks concurrently.
select cron.schedule(
 'dream-piggy-forex-poll',
 '*/5 * * * *',
 $$select net.http_get(
   url := (select decrypted_secret from vault.decrypted_secrets where name='dream_piggy_api_url') || '/api/cron',
   headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='dream_piggy_cron_secret')),
   timeout_milliseconds := 25000
 );$$
);
-- Inspect cron.job_run_details and net._http_response after enabling.
-- Optional retention, only after confirming provider storage rights and retention policy:
-- select cron.schedule('dream-piggy-forex-retention','0 3 * * *',
-- $$delete from public.forex_snapshots where observed_at < now()-interval '90 days';$$);
