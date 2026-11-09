# Vercel deployment

The repository uses Vite plus the existing Express app. Supabase is the only deployed database/shared store; SQLite is local/test only. Configure separate test resources for Preview. A Preview must never point at a production financial ledger for convenience.

## Project settings

| Setting                   | Value                                                         |
| ------------------------- | ------------------------------------------------------------- |
| Framework / root          | Vite / repository root                                        |
| Node                      | `24.x`                                                        |
| Install / build           | `npm ci` / `npm run build`                                    |
| Output                    | `dist`                                                        |
| Function                  | `api/index.ts`, default export of `server/app.ts`             |
| Function maximum duration | 300 seconds in `vercel.json`; confirm project/runtime support |
| Cron                      | `/api/cron`, `0 8 * * *` (08:00 UTC), Bearer `CRON_SECRET`    |

Keep `api/index.ts`, `tsconfig.server.json`, NodeNext resolution and explicit `.js` imports in backend/shared TypeScript. Vite bundles the frontend only. Extensionless emitted ESM previously caused `ERR_MODULE_NOT_FOUND` despite the module being included in the function. `check:node-function` compiles the actual backend and loads it under plain Node without a TypeScript loader.

Vercel imports the app rather than starting `server/index.ts`; there is no listening port or local polling interval in the function. Provider work retains its bounded deadlines and original financial retry rules. Gemini report deadlines default to 20 seconds (maximum 25); Supabase defaults to 8 seconds (maximum 15). Financial mutations are not automatically retried by the browser.

## Routes, headers and origins

`vercel.json` routes `/api/:path*` to the function before SPA fallback and excludes API/assets from that fallback. Private APIs must return JSON authorization errors, never index HTML. Immutable hashed assets have one-year caching; API responses are private/no-store.

The wallet uses hash routes: `/#Home`, `/#My%20Wallet`, `/#Smart%20Savings`, `/#Savings%20Circles`, `/#Currency%20Rates`, `/#Reports`, `/#Settings`. Direct public/help/legal pages, `/onboarding`, `/reset-password`, origin Auth0 callbacks and `/circles/invite/<token>` load the SPA. Unknown page content is an application error view; static SPA fallback does not supply an HTTP page-404 status.

Set exact HTTPS `APP_ORIGIN=https://pay-pal-project.vercel.app` for that production domain. Preview needs its own exact origin. Register each origin in all four Auth0 callback/logout/web/CORS allowlists; the SDK callback is the origin. `VERCEL_URL` may supply a fallback only when its actual hostname is explicitly registered. A stable Preview domain reduces callback changes. Apply the [provider setup](SETUP.md) separately in every environment.

Static HTML uses CSP from `vercel.json`; Express's runtime-derived CSP cannot override Vercel's static response. Custom Auth0/Supabase domains need their exact HTTPS origins added to the appropriate static `connect-src`/`frame-src` rules. Preserve PayPal Sandbox script, frame, connect and image hosts. Inspect deployed CSP failures without disabling the policy wholesale.

## Release procedure

1. Back up the intended database; inspect its migration history and apply **only missing** migrations in [filename order](../supabase/README.md). Do not run the bootstrap over an existing wallet or reset a hosted database. Reconcile legacy history if needed using [LEGACY_STORAGE.md](LEGACY_STORAGE.md).
2. Configure Auth0/Supabase, matching server keys, `STORAGE=supabase`, exact origin, Sandbox merchant credentials, optional Gemini/market settings and cron secret in Vercel. Private values belong in deployment settings, not Git or screenshots. Remove obsolete Firebase settings; no Firebase credential or database URL is needed.
3. Run the complete [local validation sequence](TESTING.md), including production artifact, auth, secret and plain Node ESM checks. Review the diff and existing MIT license.
4. Run `npm run check:deployment` with the **intended cloud settings** in a private shell. It validates configuration, not provider credentials/connectivity. A normal local HTTP origin correctly fails this cloud check. Run `npm run check:database` against the intended project for read-only schema visibility and verify applied migration history separately.
5. Commit, push and deploy manually after review. Vercel environment changes require redeployment. Prefer an isolated Preview and stable domain before promotion.
6. If manually using the Vercel CLI, `vercel pull --environment=preview` downloads sensitive ignored `.vercel` configuration; `vercel build` prepares a local bundle. Keep these artifacts private. Deployment is a separate deliberate action.
7. Inspect the actual function bundle and run `node scripts/check-node-function.mjs --entry PATH_TO_FUNCTION/api/index.js`. This loads a materialized bundle locally; it does not prove hosted provider behavior. A full linked Vercel build and plain-Node compilation are different checks.
8. Complete the isolated Preview checks below before describing a provider-backed demo as verified. Preserve operation IDs/statuses as evidence, never credentials.

## Preview smoke checks

- Public pages/deep links, all seven private views, direct invitation return, correct asset MIME, signed-out JSON denial, no-store caching and browser console/CSP.
- Email registration/login/reset delivery, canceled login, PayPal Sandbox sign-in, renewal/logout/account switching, two-user hosted RLS and no stale private cache data.
- Real Sandbox USD funding and any advertised ILS flow, one persisted credit, cancel/pending/uncertain recovery, repeated reconciliation and provider refund/review.
- Goal creation/default switching, exact round-ups, fresh/expired FX quotes, explicit skipped savings, historical assignment, personal-goal deletion/refunds and retained ledger history.
- Invitation preview/explicit join, nonmember denial, contributions/shares, fixed contributor snapshot, missing approval denial, unanimous execution/replay, rejection/expiry and returns.
- Report totals/periods/archive, deterministic coach/hypothetical states, real Gemini success/fallback and explicit rule acceptance. AI must never initiate money movement.
- Authenticated cron, anonymous cron denial, shared limits, lease expiry/stale-worker rejection and hosted service-only RPC grants.

The [guarded live test runners](TESTING.md) cover a defined subset. Controlled provider faults, actual expiration/mailbox challenges, broader currency/UI permutations and hosted platform behavior still require their own fixtures or manual checks.

## Operations and recovery

| Symptom                                 | Check                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Import failure / `ERR_MODULE_NOT_FOUND` | Node 24, NodeNext check, `.js` backend imports, complete traced files and plain-Node bundle smoke.                  |
| API returns HTML                        | Ordered API rewrite, Vite root/output, actual requested `/api/...` path.                                            |
| Supabase `PGRST202` / `PGRST205`        | Intended project, missing migrations/functions, exposed public schema and PostgREST cache reload; keep RLS enabled. |
| Origin/callback denial                  | Exact `APP_ORIGIN`, registered Auth0 origin and existing frontend header. Do not enable wildcard CORS.              |
| Shared protection unavailable           | Backend-storage migration/RPC grants, database deadlines and availability. Do not bypass fail-closed protection.    |
| Funding timeout                         | Reconcile the original persisted order; a provider capture may have completed despite a lost response.              |
| AI unavailable                          | Key/model/API entitlement, quotas and deadline; calculated totals remain authoritative.                             |
| Missing invite/join                     | SPA rewrite, migration chain, valid unexpired/unrevoked token, fresh session.                                       |
| Cron/duration trouble                   | Secret, schedule/project support, function logs and bounded work. Preview is not the production scheduler.          |

Deployment rollback restores a compatible application/configuration, not database migrations, payments or balances. Preserve ledger history, operation IDs, backups and originals; prefer reviewed forward schema fixes. Legacy adapter rollback has additional provider-isolation requirements in [LEGACY_STORAGE.md](LEGACY_STORAGE.md).

Daily cron and shared due checks are not continuous market ingestion. Large all-user alert jobs may exceed a function budget; a bounded continuation design is needed before that scale. Cached JSON has a 4 MB per-record bound; monitor legacy account sizes, historical retention, SQL latency and cleanup throughput. Financial/history data has no general destructive retention job. Funding has no webhook/refund worker. Operator/legal/support and retention commitments need owner review before a public financial launch.
