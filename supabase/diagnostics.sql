-- Read-only diagnostics for Supabase SQL Editor. Does not read user records.
select t.schemaname,t.tablename,t.rowsecurity,
  has_table_privilege('anon',format('%I.%I',t.schemaname,t.tablename),'SELECT') as anon_select,
  has_table_privilege('authenticated',format('%I.%I',t.schemaname,t.tablename),'SELECT') as authenticated_select,
  has_table_privilege('authenticated',format('%I.%I',t.schemaname,t.tablename),'UPDATE') as authenticated_update,
  has_table_privilege('service_role',format('%I.%I',t.schemaname,t.tablename),'SELECT') as backend_select
from pg_tables t where t.schemaname='public' and t.tablename in
 ('profiles','wallets','transactions','ledger_entries','savings_rules','savings_goals',
  'savings_allocations','exchange_rates','currency_alerts','notifications','ai_reports')
order by t.tablename;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' order by tablename,policyname;

select p.oid::regprocedure as function_signature,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as backend_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'walletwise_%' order by p.proname;

select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;
-- If present, inspect versions through `supabase migration list` with your linked project.
