# Dream Piggy Bank Supabase PostgreSQL

## Goal-only Smart Savings and Circles upgrade

Existing installations must apply `202610310001_savings_destinations.sql` first (if not already applied), then the complete `202610310002_goal_savings_circles.sql`, before running the new savings server/UI. Apply migrations in filename order; do not rerun `setup-wallet.sql` against an existing wallet database. The upgrade preserves wallet balances and financial history. Historical unassigned savings require an explicit, neutral assignment to a personal goal; new round-ups require a selected personal or Circle goal.

Run `npm run check:savings` for a read-only check of the required PostgREST objects. A `ready: false` result means the migration or schema-cache reload is still required. No deployment is performed by that check. See [the implementation and migration report](../SAVINGS_CIRCLES_IMPLEMENTATION.md) for accounting, quote, invitation, voting and recovery details.

Auth0 remains the only login provider, including the existing email and `paypal-sandbox` connection. There is no Supabase Auth login or token exchange.

For membership-aware invitations, also apply [202611010001_circle_invitation_membership.sql](migrations/202611010001_circle_invitation_membership.sql) after the Circle migration. It adds service-only invitation status and join functions without changing balances or existing memberships. Existing members see “You're already in this circle” and Open Circle instead of Join Circle. A Circle row lock prevents repeated joins from creating additional join events. Public invitation previews remain unchanged. Regenerated `setup-wallet.sql` includes this upgrade for new databases; existing databases should use the versioned migration.

## Deployment configuration

1. Create/select a Supabase project. Link the CLI with `supabase link --project-ref <project-ref>`, then apply all versioned migrations with `supabase db push`. Alternatively, run the SQL files in filename order in the SQL editor as the database owner. Back up an existing database before deployment; this initial schema expects the Dream Piggy Bank table names to be unused.
2. In **Authentication ? Third-party Auth**, add **Auth0** with your tenant ID and region. For `dev-arafat.eu.auth0.com`, these are `dev-arafat` and `eu`; confirm against your actual `AUTH0_DOMAIN`. Keep the existing Auth0 application, callbacks, email connection and PayPal Sandbox connection.
3. Deploy `auth0-actions/add-supabase-authenticated-role.js` as an Auth0 **Post Login** Action and attach it to the Login flow. It sets the literal, non-namespaced **ID-token** claim `role: "authenticated"`. Do not substitute an access-token claim. Use RS256 signing. Sign out and sign in again so existing sessions obtain the new claim.
4. Configure server environment variables:

   ```dotenv
   AUTH0_ENABLED=true
   # Keep the existing AUTH0_DOMAIN and AUTH0_CLIENT_ID (no custom API audience).
   SUPABASE_ENABLED=true
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<publishable-key>
   SUPABASE_SECRET_KEY=<server-secret-key>
   ```

   The server supports legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` alternatives. Never put a secret/service-role key in a `VITE_` variable. Only the URL and publishable key are returned from `/api/config`. Restart the server after configuration changes. CSP permits only the configured Supabase origin.

5. Leave `private` out of the Data API's exposed schemas. In Supabase's API settings, disable automatic grants for new public objects if offered. Migrations revoke default table/sequence/function privileges for objects created by `postgres` in `public`; if you use another migration owner, apply equivalent default-privilege rules for that owner too. Grant future objects explicitly.
6. Validate with two separate Auth0 accounts: each starts with three empty wallets; complete onboarding, reload, and confirm the preferences survive. Query `profiles` with each account's ID token and confirm only its own row is returned. Check a missing/forged/expired token is rejected by the hosted gateway. Do not use a service key for this browser validation.

The integration follows the [official Supabase Auth0 guide](https://supabase.com/docs/guides/auth/third-party/auth0): the browser SDK's `accessToken` callback returns `getIdTokenClaims().__raw`. Supabase verifies the signature and trusted issuer before PostgreSQL evaluates RLS. The local role check is a configuration guard, not signature verification. The existing first-party Express server verifies the same app-bound Auth0 **ID token** (issuer, client-ID audience, RS256, expiry, subject, authenticated role and authorized party), then derives the opaque `sub` used for backend operations. Neither email nor a UUID conversion identifies an account.

## Database and service boundaries

- `src/supabase.ts`: official SDK, current ID-token callback, no Supabase session storage, no anonymous fallback after logout.
- `server/supabase.ts`: server-only database services for profiles, preferences, wallets, transactions and ledger RPCs.
- `server/database-state.ts`: maps PostgreSQL financial data into the existing UI, reports and currency insights.
- `migrations/202610260001_walletwise_core.sql`: all eleven requested tables, RLS, explicit grants, initialization/onboarding and transactional ledger functions.
- `migrations/202610260002_wallet_preferences.sql`: atomic partial preference updates and persisted round-up rules.
- `migrations/202610260003_accept_savings_rule.sql`: atomic acceptance of existing report recommendations, with settings and ledger revision checks. Apply this new migration before using recommendation acceptance with Supabase.

Clients have SELECT-only grants with subject-based RLS. Exchange rates are shared with authenticated clients. Even `service_role` has only SELECT access to these tables; writes use explicitly granted security-definer functions with an empty search path. The database owner remains responsible for administrative maintenance. Default grants do not affect unrelated existing tables.

Initialization inserts the profile, ILS/USD/JOD wallets and savings rules atomically with conflict handling. Wallets start at zero. Onboarding locks the profile and completes once; subsequent preference changes use a separate patch operation. All monetary amounts are integer minor units: 100 per ILS/USD, 1000 per JOD. Balances and postings are bounded to JavaScript's safe-integer range.

Monetary operations lock the user's wallets in currency order, check per-currency balanced postings and nonnegative balances, and commit the transaction, ledger and balances together. `(auth0_sub, request_id)` prevents duplicate execution; a changed fingerprint rejects key reuse. Refunds must reverse an owned purchase and can occur only once even with a different request ID. No public route credits arbitrary opening balances. PayPal Sandbox capture credits test balances only through the new atomic funding RPCs; these are not real customer funds.

All private auxiliary goals, alerts, notifications and cached report history now persist in `account_state`, keyed by verified owner with optimistic version checks. The old cache is used only to import an existing verified account's legacy auxiliary records on first access, without deleting originals. Financial balances and history remain authoritative in the established SQL ledger. Shared provider caches and rate-limit coordination can still use SQLite/Firestore.

- `migrations/202610290001_forex_snapshots.sql`: persisted authenticated market history.
- `migrations/202610300001_account_state_funding.sql`: owner-scoped account state, funding attempts, unique provider IDs, atomic funding credits, verified full-refund reversals and review status. Clients have SELECT-only grants. Service-role direct writes apply only to versioned auxiliary account state; funding/ledger writes require the RPCs.
- `migrations/202610300002_gemini_reports.sql`: the current reports implementation's persisted cache/history; apply in migration order.

Apply all migrations to the intended project without reset. If the API returns `PGRST205`, check the project/schema, apply missing migrations and reload its schema cache. See [PAYPAL_FUNDING.md](../PAYPAL_FUNDING.md) for merchant configuration and recovery.

## Verification

```sh
npm test
npm run lint
npm run build
npm run test:e2e -- tests/e2e/auth.spec.ts tests/e2e/onboarding.spec.ts
```

`tests/database.test.ts` executes all migrations in PGlite (embedded PostgreSQL), including RLS and grants under actual `authenticated`, `anon` and `service_role` roles. Only `pgcrypto` installation is omitted in that harness because core PostgreSQL already supplies `gen_random_uuid()`. It tests all user tables, zero wallets, JOD accounting, rollback, replay, refund protection and onboarding/preferences. SDK tests inspect actual outgoing authorization headers and logout behavior. Backend tests cover verified subject propagation and persisted savings rules; existing Auth0 tests verify signed JWTs.

For a full local Supabase stack with Docker and the Supabase CLI:

```sh
supabase start
supabase db reset
supabase test db
```

The pgTAP smoke suite in `tests/rls.sql` runs in a rolled-back transaction. Local SQL tests simulate claims _after_ gateway verification; they do not prove a hosted Auth0/Supabase tenant is configured correctly. Hosted gateway verification requires the manual deployment checks above.

## Current authentication status

See [AUTH0_SETUP.md](../AUTH0_SETUP.md) for the 2026-10-27 audience removal and live blockers. Audience-free email redirects reach Auth0 login; PayPal reports a disabled connection. The currently configured Data API returns PGRST205 for Dream Piggy Bank tables. Confirm the intended project and migrations before testing authenticated profiles. The earlier audit is historical.

## Audit diagnostics

See `../AUDIT_REPORT.md` for the verification performed on 2026-10-26 and remaining deployment checks. The audit did not alter live user data or apply migration 003.

```sh
npx tsx scripts/check-integrations.ts
npx tsx scripts/check-pma-readonly.ts
npx tsx scripts/audit-secrets.ts
```

These diagnostics issue read-only external requests and print statuses instead of tokens or user records. Tests ignore local environment files; Playwright uses its own API/frontend ports (3101/5187), disabled external integrations, and controlled authentication/provider fixtures and isolated test data. Local runtime precedence is deployment/process variables, `.env.local`, `.env`, then `.env.auth0`.


## Progressive startup read projections

Apply `migrations/202610300003_progressive_loading.sql` after the existing migrations. It adds service-only `walletwise_dashboard`, `walletwise_activity_page` and `walletwise_report_page` functions, plus owner/cursor and goal indexes. These functions project only the signed-in owner's data. Browser roles cannot execute them or change balances. Existing RLS policies, financial functions and account data are untouched.

Bootstrap reads the profile once, then wallet balances and rules concurrently. Existing accounts do not run initialization again. Missing wallets use the established zero-initialization RPC once, followed by validation; a failed repair returns an error. Dashboard projections exclude legacy JSON ledger/operation history, return the latest five saved reports, and compute complete-ledger spending/goal summaries. Activity uses stable timestamp/ID cursors and database currency/category/date/savings filters; full history is not loaded at startup. Existing SQL financial mutations and explicit report calculations keep their established data sources.

`SUPABASE_REQUEST_TIMEOUT_MS=8000` bounds database requests. SDK retries are disabled so application deadlines/idempotency govern recovery. `PERFORMANCE_DIAGNOSTICS=true` exposes fixed-label timing durations only outside production. No cloud migration was applied by this performance change.
