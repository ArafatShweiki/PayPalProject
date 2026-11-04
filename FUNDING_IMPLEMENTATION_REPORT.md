# Dream Piggy Bank: authenticated accounts and Sandbox funding

Implemented 30 October 2026 in the existing application. The design, Auth0 email/PayPal connection, Supabase authorization model, financial precision, purchase round-ups and Forex conversion model remain in place. No cloud database was reset, no actual user records were deleted, no deployment was published and no live PayPal payments were enabled.

## Result

- Removed the development wallet entry, session/hook, browser state adapter, fabricated market generator, public development market endpoints, sample selector, old fixed-amount payment UI/API and obsolete environment switches. Normal application state has no seeded balances, transactions, goals, reports or notifications.
- Protected wallet sections now require Auth0. The backend accepts no alternate Firebase login or unsigned session flag and requires Supabase for private account access. Public help/legal pages remain available.
- New profiles receive three zero-balance wallets idempotently. Existing SQL balances/history remain authoritative. Goals, alerts, notifications and auxiliary account/report state persist in owner-scoped Supabase `account_state`, with version checks, conflict retries and owner validation. Owned legacy auxiliary records can be copied once without deleting the original records.
- Home and My Wallet use one reusable Add Funds dialog, with currency/amount/method/summary, cancel/continue actions, an unavailable state, owned payment history and status recovery. USD is the conservative default. ILS is configurable after merchant verification. JOD remains conversion-only.
- Funding credits only follow server verification of the canonical Sandbox order and completed full capture. Merchant, owner binding, order, invoice, currency, amount, capture ID and status must match. Browser callbacks cannot create funds.
- Durable requests, fingerprints, stable provider keys, unique provider capture IDs and transactional balanced ledger credits prevent duplicate money. Pending/failed/canceled attempts create no postings. Capture success followed by persistence failure is recoverable from the saved order without capturing again.
- Verified full refunds can reverse a credit exactly once. Partial refunds or insufficient available balance enter review and block further private mutations. This is user-driven status reconciliation; automatic webhooks/refund polling and self-service operator resolution are not implemented.
- Funds Added records appear in existing Wallet Activity with currency, time, status, source and reference. Funding allocates no savings, counts as neither spending nor savings income, and leaves eligible purchase round-ups intact. Conversions retain validated cached quotes and atomic SQL balance updates; insufficient USD/ILS balances link to Add Funds.
- Funding and legal/account copy explain that balances are test funds, not deposits or withdrawable real money. Repetitive card badges were not restored.

## Files changed or added

| Area | Files |
| --- | --- |
| Funding UI | Added `src/Funding.tsx`; updated `src/App.tsx`, `src/Wallet.tsx`, `src/Dashboard.tsx`, `src/styles.css`. |
| Authentication/client access | `src/Auth.tsx`, `src/api.ts`, `src/supabase.ts`, `src/Settings.tsx`, `src/InfoNavigation.tsx`. Removed unused browser Firebase SDK; retained Firebase Admin for optional shared Firestore cache. |
| Market UI | `src/MarketRates.tsx`, `src/Rates.tsx`, `src/useMarketFeed.ts`: authenticated shared feed; no normal-use fabricated samples. |
| Help/legal/account copy | `src/helpContent.ts`, `src/infoContent.ts`. |
| Funding backend | Added `server/funding.ts`; updated `server/paypal.ts`, `server/app.ts`, `server/reliability.ts`. |
| Private persistence/ledger views | `server/store.ts`, `server/database-state.ts`, `server/supabase.ts`, `server/auth0.ts`, `shared/ledger.ts`, `shared/types.ts`. |
| Database | Added `supabase/migrations/202610300001_account_state_funding.sql`; updated `supabase/README.md`. |
| Environment/build/test setup | `.env.example`, `package.json`, `package-lock.json`, `vitest.config.ts`, `playwright.config.ts`, `scripts/check-integrations.ts`; added `scripts/check-auth-build.ts`, `tests/setup.ts`. Only retired flags were removed from ignored local environment files; actual credentials were not changed or printed. |
| Documentation | `README.md`, `IMPLEMENTATION.md`, `AUTH0_SETUP.md`, `PAYPAL_FUNDING.md`, `PRODUCTION_READINESS.md`, `FOREX_INTEGRATION.md`, prior UI/auth audit reports, and this report. |

The separately maintained calendar/Gemini report implementation and its `202610300002_gemini_reports.sql` migration were preserved. Existing report test fixtures were aligned with explicit report cutoff times and current provider response shapes; unrelated report changes are not attributed to funding.

New tests: `tests/access.test.ts`, `tests/account-storage.test.ts`, `tests/funding-api.test.ts`, `tests/funding-database.test.ts`, `tests/funding-verification.test.ts`, `tests/funding-savings.test.ts`, and `tests/e2e/funding.spec.ts`. Controlled opening balances and financial adapters live only in `tests/fixtures/user.ts` and `tests/fixtures/wallet-service.ts`. Existing application, authentication, database, client cache, financial, market, report and Playwright fixtures were updated to use authenticated controlled accounts. Production asset checks reject these fixture entry points.

## Removed components and services

Deleted `src/demo/service.ts`, `src/demoSession.ts`, `src/publicMarket.ts`, `server/public-market.ts`, `scripts/check-demo-build.ts`, `DEMO_MODE_REPORT.md` and `DEMO_FOREX_REPORT.md`. Removed their runtime imports, styles, state types, sample-data controls, login button, obsolete SDK initializer and retired fixed-USD checkout verifier/component/API. Removed obsolete anonymous/legacy API tests (`tests/api.test.ts`, `tests/forex-api.test.ts`, `tests/rate-limit-api.test.ts`), development adapter/market tests and their two browser suites; authenticated access, provider verification and actual SQL migration tests replace those paths.

No production test route was added. Playwright injects its own test document through request interception; the production build has neither the adapter nor a route to it. Legacy browser storage is never read to authenticate or populate a wallet.

## Auth0 and Supabase details

Email/password, registration, password reset, persistent Auth0 sessions, logout, first-user onboarding and the exact `paypal-sandbox` connection identifier remain. Google remains disabled. Browser Supabase calls continue using the existing verified Auth0 ID-token integration and authenticated role claim. Backend verification still enforces the existing issuer/client/signature/expiry/subject/role checks. There is no Supabase Auth signup or token exchange.

The additive migration creates `account_state` and `funding_orders`, owner-only SELECT policies, unique request/provider order/capture constraints, and service-only funding reserve/status/credit/refund/review RPCs. Client roles cannot update balances or invoke funding credits. The credit RPC calls the existing balanced SQL ledger function inside one transaction; SQL wallet locking, precision and nonnegative balances remain in force.

Apply all migration files in filename order to the intended project, without reset. The current reports migration `202610300002_gemini_reports.sql` must remain included. No external migration was applied during this task.

## Required environment/configuration

| Configuration | Purpose/current finding |
| --- | --- |
| `AUTH0_ENABLED=true`, domain/client/database connection and existing PayPal connection | Existing login. Auth0 discovery and RSA signing-key lookup passed; an actual tenant signup/login was not performed. |
| `SUPABASE_ENABLED=true`, URL, publishable key, server secret key | Keys/URL are present locally, but the enable flag is currently false. Its Data API returns HTTP 404 / `PGRST205` for expected account tables, including profiles, wallets, ledger, account_state and funding_orders. Verify the intended project/schema and apply migrations/reload schema cache. |
| `APP_ORIGIN` | Exact frontend origin, request-origin boundary and generated checkout return/cancel URLs. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` | All missing locally. They must identify one receiving Sandbox merchant/application; they are separate from Auth0 social-login credentials. |
| `PAYPAL_FUNDING_CURRENCIES` | Defaults to USD. Use `USD,ILS` only after confirming the configured merchant's ILS acceptance. JOD is rejected by both API and SQL schema. |
| `FUNDING_MAX_MINOR` | Default 500000, minimum order 100 minor units; hard maximum 10000000 minor units. USD/ILS have two decimals. |
| `RATE_LIMIT_FUNDING` | Default 10 requests per verified user per 60 seconds; existing entry/private mutation limits also apply. |
| `STORAGE`, optional `FIREBASE_SERVICE_ACCOUNT` | Shared cache/quota/lease coordination. Private account records are persisted in Supabase. Keep existing serverless durability configuration. |

Server-only Checkout and database secrets are never exposed to browser configuration or `VITE_` variables. PayPal API and approval hosts are fixed to Sandbox. There is no switch to live payments.

## Verification

| Command/check | Final result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm test` | 216 tests passed in 35 files. Includes actual PostgreSQL/PGlite migrations, RLS, zero initialization, exact amounts, concurrent/idempotent credits, globally unique captures, rollback recovery, refunds/review, account-state CAS/owner checks, and funding/savings/report compatibility. |
| `npm run test:e2e -- --workers=4` | 24 passed in the final complete run. Includes desktop/tablet/mobile layouts, email and PayPal login/signup routing, password reset, onboarding, account restore/logout, funding unavailable/pending/completed states, forged storage protection, savings, conversions, reports and help. |
| `npm run build` | Passed; largest generated JavaScript chunk approximately 246 kB. No test adapters are bundled. |
| `npm run check:auth-build` | Passed. Scans production assets and checks all six protected wallet sections at 1440/390 widths despite forged legacy storage and funding return parameters. No private API read occurs before sign-in. |
| Visual inspection | Funding dialog at 1440 and 390 pixels, mobile authentication; responsive automated checks also cover 820 pixels and all six application sections. |
| `npx tsx scripts/check-integrations.ts` | External configuration check reported missing/unexposed Supabase account tables (`PGRST205`), expected with current incomplete setup; forged token rejected 401. Auth0 discovery/JWKS passed. No user rows or secrets printed. |

An initial parallel unit run hit a shared SQLite I/O error under OneDrive. Unit cache databases now use separate temporary directories per worker; the final complete unit run passed. A later browser run exposed a stale test interceptor for the improved pending-checkout recovery action; its controlled capture/status routes were corrected before the final rerun. No production money-creation bypass was introduced to make tests pass.

## Unverified external steps and remaining limits

Actual Sandbox order creation, payer approval, capture, merchant receiving preferences and USD/ILS account acceptance remain unverified because Checkout credentials are absent. No external PayPal transaction is claimed as tested. The official supported-currency list includes USD and ILS, not JOD; listing is not proof of merchant acceptance. Configure a distinct business merchant and personal test payer and complete the checklist in [PAYPAL_FUNDING.md](PAYPAL_FUNDING.md).

Supabase cloud schema/grants, concurrent requests across cloud database sessions, and authenticated two-user RLS must be verified after deployment of migrations. Local PostgreSQL RLS tests are not proof that the configured cloud project is ready. Auth0 metadata connectivity is not a completed external login. Hosted cron, shared Firestore concurrency, market licensing and external Gemini account permissions remain operator/provider setup responsibilities.

There is no automatic refund webhook worker. Full refunds are detected on owned status reconciliation. Partial refunds, insufficient balance and aged unbound order-creation requests require operator review; no replacement money is fabricated. The app remains a test wallet and must not be enabled as a live money service through configuration alone.

Official references consulted: [PayPal Checkout](https://developer.paypal.com/checkout/integrate), [currency support](https://developer.paypal.com/api/codes/currency), [Orders capture](https://developer.paypal.com/api/orders/v2/orders-capture).
