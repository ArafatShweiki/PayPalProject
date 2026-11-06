import "../server/env";
import { readFileSync, readdirSync } from "node:fs";

// Inspect the exposed schema only. Never invoke an RPC, initialize an account,
// query financial records or apply a migration against the configured database.
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();
const sql = migrations
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
  .join("\n");
const tables = [
  ...new Set(
    [...sql.matchAll(/create table(?: if not exists)? public\.(\w+)/gi)].map(
      (m) => m[1],
    ),
  ),
];
const functions = [
  ...new Set(
    [...sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)].map(
      (m) => m[1],
    ),
  ),
];
try {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error();
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error();
  const schema = await response.json();
  const missing = [
    ...tables.map((name) => `/${name}`),
    ...functions.map((name) => `/rpc/${name}`),
  ].filter((path) => !schema.paths?.[path]);
  console.log(
    JSON.stringify(
      {
        ready: missing.length === 0,
        readOnly: true,
        migrations,
        missing,
        limitation:
          "Schema visibility only; does not prove applied versions, SQL bodies, grants, RLS or authenticated provider configuration.",
      },
      null,
      2,
    ),
  );
  if (missing.length) process.exitCode = 1;
} catch {
  console.error(
    "Read-only database readiness check unavailable. Verify the configured project, private key and Data API access.",
  );
  process.exitCode = 1;
}
