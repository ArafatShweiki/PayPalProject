# Dream Piggy Bank architecture

## Request and identity boundary

The browser starts with public configuration, then the existing Auth0 provider. Protected wallet UI renders only after authentication and onboarding. Email/password, registration, password reset, persistent sessions, logout and the Auth0 `paypal-sandbox` connection remain in place; Google is disabled. Auth0 subject strings remain opaque identities. Backend requests verify signatures, issuer, audience/client, expiry and the expected Supabase role claim using the existing verifier. No browser storage flag or URL argument grants access.

Express rejects private requests without this verified identity, then requires Supabase, initializes the owned profile/wallets idempotently, and enforces onboarding, ownership, request origin, request header, input validation and rate limits. The public configuration endpoint and secret-protected cron endpoint do not disclose financial records. The former public development market endpoint is removed; authenticated sessions use the existing shared market polling and cache.

## Persistence

Supabase PostgreSQL is authoritative for profiles, zero-initialized wallets, transactions, ledger postings, savings rules, reports and Forex history. `account_state` holds remaining private auxiliary records as JSON, keyed by server-derived UID with a unique Auth0 owner. Updates compare a version and retry conflicts to avoid overwriting concurrent changes. Existing verified users can import their owned legacy auxiliary records once; the original records are retained. Browser state is a view of backend data, never an authority for balances.

Monetary SQL functions lock wallets, validate minor-unit precision, ownership, balanced postings and nonnegative balances, and commit postings and balances together. USD/ILS use two decimals; JOD uses three. Client roles have SELECT-only access under subject-scoped RLS. Service-role financial writes use narrowly granted security-definer RPCs. Migrations are additive; existing account records are not reset.

SQLite/Firestore remain only for shared provider caches, quotas and leases, and reading existing auxiliary records during migration. Firebase browser authentication and its unused browser SDK were removed; optional Firebase Admin remains for the Firestore cache. No private API falls back to a local wallet when Supabase is unavailable.

## Sandbox funding

`src/Funding.tsx` is shared by Home and My Wallet. `/api/funding` is mounted behind the same authentication and private-operation controls, with a separate per-user rate limit. It reserves an owned `funding_orders` row before contacting PayPal, with a fingerprint, immutable amount/currency, stable provider request keys and unique provider order/capture IDs.

Server-only `server/paypal.ts` uses a fixed Sandbox host. `server/funding.ts` retrieves the canonical provider order and validates its merchant, custom ID, invoice ID, order ID, currency, exact minor-unit amount, full capture and completed statuses. Only then does a database RPC claim the unique capture and append a balanced available/external ledger transaction atomically. Repeated/concurrent callbacks return the original credit. A rolled-back database write leaves the durable order available for reconciliation without a second capture.

Provider pending, failed, canceled and uncertain attempts are visible in the existing activity view with zero postings. Completed credits and reversals use existing ledger transactions, mapped to Funds Added/reversal for display. These adjustments never trigger savings round-ups or become report spending. Full refunds are verified through the capture API before an idempotent reversal; partial refunds and insufficient funds enter review and block further protected mutations until resolved. Refund detection is user-driven reconciliation, not an automatic worker.

## Financial and market features

Existing purchase, round-up, refund, savings allocation/withdrawal, goal, recommendation and conversion operations retain their SQL logic. Conversions require a fresh validated cached quote and sufficient funds, and commit atomically. Insufficient USD/ILS funds link to Add Funds. JOD has no direct funding route.

The shared authenticated polling service still reads actual Forex observations from the configured provider, with cached refreshes, quota limits, timestamps and freshness. There is no fabricated normal-use market feed. Calculated and optional Gemini explanations remain available through the existing report and insight services; provider output does not control ledger amounts or grants.

## Verification boundaries

Tests keep fixture money and controlled authentication in `tests/`, injected only into Playwright routes owned by the test runner. Production builds exclude these modules and expose no fixture entry point. PGlite tests apply the actual migrations and exercise RLS, zero initialization, atomicity, duplicate capture claims, cross-owner rejection, refunds and rollback recovery. API tests independently verify provider receipts and authorization. External service eligibility still requires configured accounts and deployed migrations.

See [PAYPAL_FUNDING.md](PAYPAL_FUNDING.md), [AUTH0_SETUP.md](AUTH0_SETUP.md) and [FUNDING_IMPLEMENTATION_REPORT.md](FUNDING_IMPLEMENTATION_REPORT.md).


## Progressive initialization

Auth0's SDK remains responsible for session restoration, callback handling and renewal. The application uses valid current ID-token claims, shares concurrent renewal work, verifies the expected SDK subject, and never requests a custom API audience. The protected boundary checks the onboarding decision and essential wallet data with one authenticated bootstrap request. A request-local profile replaces repeated initialization/profile queries; reading existing auxiliary state no longer performs a write.

The bootstrap response contains verified per-currency balances and rules, with no transaction history or external provider request. Independent dashboard projections, cursor-paginated activity and the existing shared market feed load after the dashboard becomes usable. Dashboard spending and goal totals are calculated from the complete owned ledger in a service-only read function, preserving their existing semantics without transferring every transaction to the browser. Saved report pages load separately. The existing full state reader remains for explicit server report/insight calculations, with independent reads parallelized.

`server/diagnostics.ts` provides request cancellation and opt-in development timings. Database reads have an 8-second default deadline with SDK retry disabled; the frontend bounds bootstrap/token/network waits and ignores obsolete responses. Private caches remain in memory within an authentication generation and are invalidated after mutations or cleared on logout/account change. The new read functions and indexes live in `202610300003_progressive_loading.sql`; client mutation grants and financial RPCs are unchanged.

Performance evidence and limits: [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md).
