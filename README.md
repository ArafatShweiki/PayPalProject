# Dream Piggy Bank

An authenticated multi-currency test wallet built with React, TypeScript, Express, Auth0 and Supabase PostgreSQL. Users track purchases, purchase round-ups, savings goals, reports and indicative Forex observations. Wallet funding uses verified PayPal Sandbox Checkout; these balances are test funds, not bank deposits or withdrawable money. No live payments are enabled.

See [PayPal and email login: feature guide](ACCOUNT_FEATURES.md) for a comparison of what each login method can and cannot do, shared wallet features, and current limitations.

The [November 4 application test report](FULL_APPLICATION_TEST_REPORT.md) records executed results, repairs and external-service blockers. The [feature test matrix](FEATURE_TEST_MATRIX.md) maps implemented features to their test evidence and remaining coverage gaps.

## Gemini financial reports

The Reports page supports authenticated weekly and calendar-month reviews using Supabase records, deterministic calculations, and server-side Google GenAI structured output. See [Gemini implementation and deployment](GEMINI_REPORTS_IMPLEMENTATION.md) for the migration, configuration, endpoints, privacy controls, test results, and live-provider limitations. This document supersedes older report-generation descriptions below.

## Run locally

Use Node 24 or newer (the shared local cache uses `node:sqlite`).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Configure Auth0 and Supabase before entering the wallet. The default frontend is `http://127.0.0.1:5173`; Express uses port 3001. Keep `APP_ORIGIN` equal to the frontend origin. Process variables take precedence over `.env.local`, `.env`, then `.env.auth0`.

There is no anonymous wallet, development login bypass, sample-data selector or seeded account. Login, registration and password reset use the existing Auth0 application; Google remains disabled. Public help and legal pages remain accessible without exposing wallet information. New accounts receive zero-balance USD, ILS and JOD wallets through an idempotent database operation.

## Required configuration

| Variables | Purpose |
| --- | --- |
| `AUTH0_ENABLED=true`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_DATABASE_CONNECTION` | Existing Auth0 application and email connection. Keep its `paypal-sandbox` connection identifier. |
| `SUPABASE_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Persistent private accounts; the secret key stays on the server. Existing anon/service-role key aliases remain supported. |
| `APP_ORIGIN` | Exact allowed frontend origin and PayPal return origin. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` | Separate Sandbox Checkout application and its merchant. These are independent of Auth0 PayPal login. |
| `PAYPAL_FUNDING_CURRENCIES=USD` | Explicit merchant-tested funding currencies. Add `ILS` only after a successful merchant test. Never include JOD. |
| `FUNDING_MAX_MINOR=500000`, `RATE_LIMIT_FUNDING=10` | Per-order maximum in minor units and per-user funding requests per minute. Minimum is 100 minor units. |
| `STORAGE=supabase` (or unset) | All deployed shared caches, quotas, leases and history use Supabase. Explicit `STORAGE=sqlite` and `DATABASE_PATH` are isolated local/test settings only. |

No integration secret may use a `VITE_` prefix. Optional Forex and Gemini settings remain documented in `.env.example`; the existing server-side provider caches and quotas are preserved. Auth0 browser identifiers and the Supabase publishable key are public configuration, not privileged credentials.

## Database and authentication

Apply **all** SQL files in `supabase/migrations` in filename order to the intended project; do not reset the database. The latest funding migration is `202610300001_account_state_funding.sql`. The separately maintained report migration `202610300002_gemini_reports.sql` also remains required for the current reports implementation.

Configure Supabase Third-Party Auth for the existing Auth0 tenant and its authenticated role claim as described in [AUTH0_SETUP.md](AUTH0_SETUP.md) and [supabase/README.md](supabase/README.md). Clients have owner-scoped, read-only access. Financial writes require verified backend identity and narrowly granted database functions. A missing/disabled database returns an unavailable state rather than a local wallet fallback.

Private auxiliary state (goals, alerts, notifications and cached report history) now persists in owner-scoped `account_state`, with optimistic version checks. An existing verified account's legacy auxiliary records are imported on first access without deleting the originals. SQL wallets and their ledger remain authoritative; no opening balance is fabricated or transferred from browser storage.

## Funding

Home and My Wallet open the same Add Funds dialog. The backend reserves a durable funding request, creates a Sandbox order, redirects for payer approval, and verifies the canonical order and capture before atomically crediting the owned wallet. The ledger records a balanced external-to-available transfer. Funding creates no purchase round-up and does not count as spending or savings income.

Pending, failed and canceled attempts do not change balances. Stable provider keys, unique capture constraints and transactional crediting prevent duplicate money. The dialog can reconcile an uncertain payment after a timeout or database failure. Full, provider-verified refunds can be reversed once; partial refunds or insufficient available funds require review. This implementation does not initiate refunds or implement a webhook worker.

See [PAYPAL_FUNDING.md](PAYPAL_FUNDING.md) for configuration, the exact flow, currency limitations and recovery procedures. JOD remains available for existing internal test conversions using cached real-world exchange quotes.

## Fast authenticated startup

The existing Auth0 SDK restores the session, reuses its valid ID token, and makes one `/api/bootstrap` request for the owned profile, onboarding decision, wallet balances and savings rules. Existing accounts are not reinitialized. Missing wallet rows are repaired once through the existing idempotent operation; unavailable balances produce a recoverable error, never substitute zeros.

After the essential data is verified, the dashboard renders and independently loads `/api/dashboard`, the first 25 `/api/activity` records, and the shared market feed. Charts, goals, reports, notifications and activity have their own skeletons/retry states. Activity filters execute before database pagination; older activity and reports load on demand. Financial mutations invalidate private reads and refresh authoritative balances. Logout/account changes clear private caches and cancel obsolete requests.

Apply the additive `supabase/migrations/202610300003_progressive_loading.sql` migration after the existing migrations. It adds service-only read projections and indexes; it does not change wallet balances, financial mutation functions or RLS policies. `SUPABASE_REQUEST_TIMEOUT_MS` defaults to 8000; hidden SDK database retries are disabled. Client startup has bounded token, database and network waits.

Run `npm run check:startup` for the controlled latency benchmark. Enable `PERFORMANCE_DIAGNOSTICS=true` only in development to inspect safe `Server-Timing` durations. Development browser User Timing entries begin with `dpb:` and contain fixed stage names/durations, never tokens or user records. See [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) for measurements, test coverage and the live-environment boundary.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run check:auth-build
npm run check:startup
```

Tests use controlled provider responses, locally signed JWTs, PostgreSQL/PGlite with the actual migrations, and fixtures confined to `tests/`. Browser tests cover Auth0 login/signup/PayPal connection routing, onboarding, persisted account loading, financial journeys and responsive layouts. They do not prove external tenant or merchant eligibility.

`npx tsx scripts/check-integrations.ts` checks external Auth0 discovery and Supabase table visibility without printing credentials or user rows. `npm run check:forex` checks configured market-data coverage and quotes. Neither command changes account balances.

## Deployment boundary

No cloud migration, deployment or live financial service is enabled by this change. Vercel requires the existing durable shared-cache configuration and all server environment variables; keep secrets out of Git. Review [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and the current [implementation report](FUNDING_IMPLEMENTATION_REPORT.md) before enabling Sandbox access. No real-money deposits, withdrawals or trading are implemented.

## Vercel deployment

See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for this repository's deployment settings, required credentials, database migrations, provider configuration, validation results and rollout checklist. Do not use SQLite storage on Vercel.

## Supabase-only shared storage

Firebase Admin/Firestore is removed. Apply `202611060001_backend_storage.sql` after the existing migrations before deployment. Use [SUPABASE_ONLY_MIGRATION.md](SUPABASE_ONLY_MIGRATION.md) for the storage inventory, preserved local data, dry-run imports, security design and rollback, and [SUPABASE_ONLY_VALIDATION.md](SUPABASE_ONLY_VALIDATION.md) for actual verification. Run `npm run test:postgres` for real PostgreSQL concurrency tests with independent connections; no hosted credentials are used.
