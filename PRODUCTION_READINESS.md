# Deployment readiness

This application is an authenticated **test wallet**. Sandbox payment verification does not authorize real-money deposits, withdrawals or trading. No deployment, cloud migration or live payment configuration was performed for this change.

## Required before local or hosted account use

- Configure the existing Auth0 application, callback/logout/web-origin allowlists, email database connection and `paypal-sandbox` connection. Google remains disabled. Confirm the authenticated role claim and the Supabase Third-Party Auth issuer configuration.
- Point the server at the intended Supabase project and apply all migrations in order, without reset. Enable Supabase only once schema/grants are ready. RLS must remain enabled; browser roles must not receive balance mutation grants.
- Configure a separate Sandbox Checkout merchant/application and merchant ID. Verify USD and explicitly verify ILS before advertising it for that merchant. Keep JOD conversion-only. Secrets must remain server-side.
- Set the exact frontend `APP_ORIGIN`. On Vercel use the existing Firestore-backed shared provider cache, quota and lease configuration; ephemeral SQLite is not a durable multi-instance cache. Private account data stays in Supabase.

## Current external check

On 30 October 2026, a read-only configuration probe found Auth0 enabled and discovery/JWKS accessible. Supabase is disabled locally, and its configured Data API returned HTTP 404 / `PGRST205` for the expected account tables, including profiles, wallets, ledger, account_state and funding_orders. Check the project and apply all migrations; these results do not prove a physical table exists or establish authenticated RLS behavior in the cloud. A forged token was rejected with 401.

Checkout client ID, client secret and merchant ID are missing locally. No real Sandbox create/capture request was performed; USD/ILS acceptance for this merchant remains unverified. Local automated provider/database/browser tests do not substitute for these external checks.

## Operations and remaining limitations

Funding reconciliation is user-driven through owned callbacks/status checks. There is no webhook worker or automatic provider refund sweep. Full verified refunds can be reversed atomically when available funds suffice. Partial refunds, insufficient funds and aged unbound creation requests require operator review; financial mutations are blocked for refund-review accounts. Review these procedures before exposing even a public test service.

Public policy/support copy requires operator review, including actual support contact, retention and deletion commitments. There is no self-service account deletion or universal retention cleanup. Full wallet history is still loaded for existing financial reports rather than paginated end to end. No Lighthouse profiling, external tenant signup, external Sandbox merchant flow, multi-instance cloud race test or hosted cron exercise is claimed.

## Local verification

TypeScript, ESLint, automated tests, responsive Chromium journeys and production builds are required. `npm run check:auth-build` also inspects production assets for test-only entry points and checks login protection at desktop/mobile sizes despite forged storage and callback parameters. PostgreSQL/PGlite tests execute actual migrations and enforce owner-only grants, zero initialization, balanced credits, capture uniqueness, rollback recovery and refund behavior.

See [FUNDING_IMPLEMENTATION_REPORT.md](FUNDING_IMPLEMENTATION_REPORT.md) for the final commands/results and [PAYPAL_FUNDING.md](PAYPAL_FUNDING.md) for setup/recovery.
