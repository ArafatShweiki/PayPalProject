-- Preserve old reports and their existing ownership RLS. Browser writes remain denied.
alter table public.ai_reports
  add column period_start timestamptz,
  add column period_end timestamptz,
  add column model text,
  add column prompt_version text,
  add column input_fingerprint text,
  add column status text check(status in ('complete','ai_unavailable','empty')),
  add column recommendations jsonb not null default '[]'::jsonb;
create unique index reports_input_status on public.ai_reports(auth0_sub,input_fingerprint,status);
grant insert,update on public.ai_reports to service_role;
