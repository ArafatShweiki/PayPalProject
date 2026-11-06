import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

// Standalone bootstrap for a project whose only app table is forex_snapshots.
// Existing wallet objects are conflicts, not permission to overwrite a schema.
const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sources = files.map((f) =>
  readFileSync(`supabase/migrations/${f}`, "utf8"),
);
const tables = sources.flatMap((sql) =>
  [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]),
);
const indexes = sources.flatMap((sql) =>
  [...sql.matchAll(/create (?:unique )?index (\w+)/g)].map((m) => m[1]),
);
const names = (values: string[]) => values.map((v) => `'${v}'`).join(",");
const forex = sources[files.indexOf("202610290001_forex_snapshots.sql")];
const forexBody = forex.match(/as \$\$([\s\S]*?)\$\$/)![1];
const forexLiteral = `'${forexBody.replaceAll("'", "''")}'`;
const preflight = `-- Run the entire file in Supabase SQL Editor as postgres.
-- Intended starting state: forex_snapshots may exist; wallet tables must be absent.
-- Conflicting wallet objects abort the transaction instead of being overwritten.
-- This is a bootstrap, not a rerunnable upgrade of an existing wallet installation.
BEGIN;
SELECT pg_advisory_xact_lock(20261030, 4261);
DO $preflight$
DECLARE name text; col record; actual_type text; required boolean;
BEGIN
  FOREACH name IN ARRAY ARRAY[${names(tables.filter((t) => t !== "forex_snapshots"))},${names(indexes.filter((i) => i !== "forex_snapshots_observed_idx"))}] LOOP
    IF to_regclass('public.' || name) IS NOT NULL THEN
      RAISE EXCEPTION 'Schema conflict: public.% already exists. No changes committed. Inspect existing objects before applying wallet migrations.', name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN (${names(sources.flatMap((sql) => [...sql.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1])).filter((n) => n !== "forex_history"))}))
       OR (n.nspname='private' AND p.proname='auth0_subject')) THEN
    RAISE EXCEPTION 'Schema conflict: a wallet function already exists. No changes committed. Inspect it before applying this bootstrap.';
  END IF;
  IF to_regclass('public.forex_snapshots') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.forex_snapshots') AND relkind='r') THEN
      RAISE EXCEPTION 'Schema conflict: public.forex_snapshots must be an ordinary table';
    END IF;
    FOR col IN SELECT * FROM (VALUES ('id','text'),('observed_at','timestamp with time zone'),('fetched_at','timestamp with time zone'),('snapshot','jsonb')) AS expected(name,type) LOOP
      SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull INTO actual_type,required
        FROM pg_attribute a WHERE a.attrelid=to_regclass('public.forex_snapshots') AND a.attname=col.name AND a.attnum>0 AND NOT a.attisdropped;
      IF actual_type IS DISTINCT FROM col.type OR required IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Schema conflict: forex_snapshots.% must be % NOT NULL; existing data has not been changed', col.name,col.type;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id'
      WHERE c.conrelid=to_regclass('public.forex_snapshots') AND c.contype='p' AND c.conkey=ARRAY[a.attnum]) THEN
      RAISE EXCEPTION 'Schema conflict: forex_snapshots requires a primary key on id';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.forex_snapshots') AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','observed_at','fetched_at','snapshot') AND a.attnotnull AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='') THEN
      RAISE EXCEPTION 'Schema conflict: forex_snapshots has extra required columns without defaults';
    END IF;
  ELSIF to_regclass('public.forex_snapshots_observed_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'Schema conflict: forex_snapshots_observed_idx exists without forex_snapshots';
  END IF;
  IF to_regclass('public.forex_snapshots_observed_idx') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.forex_snapshots_observed_idx') AND indrelid=to_regclass('public.forex_snapshots') AND indisvalid
  ) THEN
    RAISE EXCEPTION 'Schema conflict: forex_snapshots_observed_idx is not a valid index on forex_snapshots';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='forex_history'
    AND (p.oid IS DISTINCT FROM to_regprocedure('public.forex_history(timestamptz,integer)')
      OR p.prorettype<>'jsonb'::regtype OR NOT p.proretset OR p.prosecdef
      OR regexp_replace(p.prosrc,'\\s','','g')<>regexp_replace(${forexLiteral},'\\s','','g'))) THEN
    RAISE EXCEPTION 'Schema conflict: existing forex_history differs from the expected function; it will not be overwritten';
  END IF;
END $preflight$;
`;

const body = sources
  .map((source, i) => {
    let sql = source;
    // Individual migrations can be atomic on their own. The guarded bootstrap
    // already owns its outer transaction and must not commit it mid-install.
    if (files[i] === "202611060001_backend_storage.sql")
      sql = sql.replace(/^BEGIN;\r?\n|^COMMIT;\r?\n?/gm, "");
    if (files[i] === "202610260001_walletwise_core.sql") {
      // Do not change unrelated private-schema ACLs or defaults for future objects.
      // All new app functions/tables have explicit REVOKE/GRANT statements below.
      sql = sql
        .replace(
          "-- Remove broad default grants and expose only RLS-filtered reads to clients.",
          "-- Expose only RLS-filtered reads on the new app tables to clients.",
        )
        .replace(
          "revoke all on schema private from public, anon, authenticated;",
          "",
        )
        .replace(/^alter default privileges.*;\r?\n/gm, "")
        .replace(
          "-- Opt in future objects explicitly, including functions (PUBLIC otherwise inherits EXECUTE).",
          "-- Permissions are scoped to the app objects created by this bootstrap.",
        );
    }
    if (files[i] === "202610290001_forex_snapshots.sql") {
      sql = sql
        .replace(
          "create table public.forex_snapshots",
          "create table if not exists public.forex_snapshots",
        )
        .replace(
          "create index forex_snapshots_observed_idx",
          "create index if not exists forex_snapshots_observed_idx",
        )
        .replace(
          "create policy forex_read on public.forex_snapshots for select to authenticated using (true);",
          `DO $policy$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.forex_snapshots'::regclass AND polname='forex_read') THEN
    CREATE POLICY forex_read ON public.forex_snapshots FOR SELECT TO authenticated USING (true);
  END IF;
END $policy$;`,
        );
      const start = sql.indexOf("create function public.forex_history");
      const end = sql.indexOf("$$;", start) + 3;
      const definition = sql.slice(start, end);
      sql =
        sql.slice(0, start) +
        `DO $function$ BEGIN
  IF to_regprocedure('public.forex_history(timestamptz,integer)') IS NULL THEN
    EXECUTE $definition$${definition}$definition$;
  END IF;
END $function$;` +
        sql.slice(end);
    }
    return `-- Migration: ${files[i]}\n${sql}`;
  })
  .join("\n\n");
const result = `${preflight}\n${body}\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
writeFileSync("supabase/setup-wallet.sql", result);
mkdirSync(".temp", { recursive: true });
writeFileSync(".temp/setup-wallet.sql", result);
console.log("Wrote supabase/setup-wallet.sql and .temp/setup-wallet.sql");
