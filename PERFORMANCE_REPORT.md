# Login and dashboard performance report

Implemented 30 October 2026 in the existing application. Authentication, financial calculation utilities, financial mutation RPCs, wallet balances, PayPal Checkout host/verification and RLS policies were preserved. No cloud migration, tenant configuration change, actual payment or account reset was performed.

## Evidence and root cause

The previous startup code executed this sequence after Auth0 restoration: AuthGate GET onboarding, a browser Supabase profile read, OnboardingBoundary GET onboarding again, then App GET full state. Each backend request initialized the account and called an auxiliary-state update; reading auxiliary state itself also performed a versioned write. The full state reader then sequentially loaded the profile, wallets, every 500-row transaction page, savings rules, auxiliary state and pending funding attempts. A slow history/database read kept the entire protected view behind the loading screen.

These were measured against the actual Express middleware and data-reader code with an isolated SDK transport fixture: 1,501 transactions, a completed owned account and 30 ms latency per database operation. The baseline trace recorded 27 operations, including three initialization RPCs, four auxiliary writes, four transaction pages, and a redundant browser profile read. It was captured before changing the startup code. Fixture records and credentials are confined to tests; no user account was benchmarked.

A separate stalled-request test exposed automatic retries inside the installed PostgREST SDK, which extended a nominal database timeout beyond five seconds in that controlled test. SDK retries are now disabled; request deadlines and explicit application retry/idempotency rules govern recovery. Auth0 restoration was not shown to be the primary delay; its SDK remains responsible for restoring sessions and processing callbacks.

## Before and after

| Critical startup metric | Before | After |
| --- | --- | --- |
| Median controlled API/database critical path | 964 ms | 94 ms |
| Three samples | 942, 976, 964 ms | 122, 70, 94 ms |
| Blocking authenticated/browser profile requests | 4 | 1 |
| Database operations before rendering | 27 | 3 |
| Initialization RPCs for an existing account | 3 | 0 |
| Auxiliary writes before rendering | 4 | 0 |
| Full transaction pages before rendering | 4 | 0 |

The median reduction is 90.2 percent in this controlled scenario. This is a local latency benchmark, not a production speed guarantee or a live Auth0/Supabase timing claim. Imports are completed before the timed server samples; the comparison measures the authenticated data path rather than server cold-start time. The Auth0 verifier is controlled in this benchmark; genuine JWT verification remains covered separately.

The final `Server-Timing` sample identified the profile read at about 44 ms and parallel wallet/rule reads at about 31 ms each. Those fixture delays account for most of the remaining essential path. No whole-history read, payment request or AI request appears on that path.

Raw samples and operation lists: [before](performance-results/startup-before.json), [after](performance-results/startup-after.json).

## Browser measurements

The actual Auth0 React SDK, mocked OAuth/provider responses and the actual protected UI were exercised in development Chromium. Fixed-label User Timing marks measured SDK restoration, the combined profile/onboarding/essential-wallet bootstrap, and when the dashboard became usable. The reload uses the SDK's persistent session. These are local development measurements with mocked APIs, not external provider latency measurements.

| Scenario | SDK restoration | Profile + essential wallet bootstrap | Dashboard usable from configuration start | Bootstrap reads per navigation | Separate browser profile reads |
| --- | --- | --- | --- | --- | --- |
| callback | 65 ms | 22.6 ms | 479.7 ms | 1 | 0 |
| refresh | 12.7 ms | 42.1 ms | 407.8 ms | 1 | 0 |

The profile and essential-wallet browser durations refer to the same combined request and must not be added together. Individual server profile/wallet durations are available through `Server-Timing`. Browser data-path requests are one essential bootstrap followed by three independent background reads (dashboard projection, first activity page and shared market feed). Public configuration and OAuth calls are additional. No duplicate onboarding or browser profile request is made.

There is no historical browser-stage timing snapshot for SDK restoration before this change; no before/after percentage for Auth0 service latency is claimed. The measured before/after improvement above is the actual server/data sequence. Browser tests also hold background responses indefinitely and prove that verified balances/navigation render before those responses complete. A failed background section can retry without repeating bootstrap.

Raw browser measurements: [startup-browser-after.json](performance-results/startup-browser-after.json). Timings vary with local compilation, worker load and cache state.

## Implemented changes

- One authenticated `/api/bootstrap` request verifies the owned profile/onboarding decision and loads balances/rules concurrently. Existing profiles are not initialized again. Missing wallets are repaired once using the existing idempotent initializer; a failed repair gives a recoverable error. Missing/unavailable data never becomes a substitute zero balance.
- The request-local profile is reused by onboarding, the protected-route check and the state reader. Reading an existing auxiliary record no longer performs a compare-and-swap write. Actual auxiliary mutations retain version checks and conflict retries.
- `/api/dashboard` returns projected auxiliary data, five latest reports, complete-ledger spending aggregates and goal totals without transferring legacy ledger/operation history. Aggregates preserve existing gross purchase spending and refund-aware goal calculations. They do not classify funding as spending or savings.
- `/api/activity` uses stable timestamp/ID cursors, 25 visible records per page, a lookahead for the next page, and database currency/category/date/savings filters. It merges ledger transactions and uncredited funding attempts without adding financial postings. Existing activity/details remain the UI. Older reports load independently through `/api/account/reports`.
- Dashboard cards, activity, goals, reports, alerts and notifications use independent loading/error states. Failed background data does not hide verified balances. The existing market polling/cache/history remain separate. AI generation and Checkout requests do not start during ordinary dashboard initialization.
- The existing Auth0 SDK supplies valid current ID-token claims; concurrent renewals share one promise and only renew near expiry or when claims are missing. The subject must match the SDK user. The opaque access token is discarded. The role check, issuer/client/signature validation, email/PayPal connections and no-custom-audience behavior remain intact.
- Wallet application code preloads in parallel with bootstrap. The redundant browser profile probe no longer constructs a Supabase browser client at startup. The browser SDK remains available for explicit direct reads, with its existing ID-token integration. Backend Supabase access is unchanged in purpose.
- Private in-memory reads retain deduplication and a short TTL, invalidate around mutations, and clear on logout/subject changes. Request subscribers can cancel without disrupting another component sharing the same read; the last departing subscriber aborts the underlying request. Obsolete responses cannot replace another user's view.
- Token retrieval is bounded at eight seconds inside a twelve-second bootstrap budget. Database requests default to eight seconds. Background API reads use an overall twenty-second budget, with at most one safe network retry within that budget. SDK restoration uses a ten-second HTTP timeout and a fifteen-second recoverable loading guard. Financial writes are not automatically retried by the browser or database SDK; existing idempotency/reconciliation remains authoritative.

## Bundle evidence and visual verification

The previous production build emitted a Supabase browser SDK chunk of approximately 223.73 kB (58.62 kB gzip). The final startup bundle emits no Supabase browser SDK chunk because that unused startup dependency can be tree-shaken. The SDK package, server services and explicit browser adapter are retained. Current chunks are approximately 246.98 kB entry, 246.33 kB Auth0 and 80.25 kB wallet UI, plus the separately loaded public module. The wallet UI increased to support progressive sections; there is no large-chunk build warning.

The existing colors, typography, card layout and responsive navigation remain. Desktop/mobile screenshots were inspected, including genuine balances alongside independently loading cards. Browser coverage also checks all six application pages at desktop/tablet/mobile widths. No loading animation was shortened to conceal work.

## Files and migration

New runtime files: `server/bootstrap.ts`, `server/progressive.ts`, `server/diagnostics.ts`, `src/useWalletData.ts`, `src/DeferredSection.tsx`, `src/performance.ts`.

Updated runtime files: `server/app.ts`, `server/onboarding.ts`, `server/supabase.ts`, `server/store.ts`, `server/database-state.ts`, `src/Auth.tsx`, `src/Onboarding.tsx`, `src/App.tsx`, `src/api.ts`, `src/requestCache.ts`, `src/supabase.ts`, `src/useMarketFeed.ts`, `src/Dashboard.tsx`, `src/Wallet.tsx`, `src/savings.ts`, `src/styles.css`, `shared/types.ts` and `vite.config.ts`. The full-state reader's independent reads are parallelized for explicit consumers; it is no longer the frontend startup path. Gemini/report implementation and financial formulas were retained.

New migration: `supabase/migrations/202610300003_progressive_loading.sql`. Apply it after the existing migrations. It adds three service-only read functions and owner/time/cursor/goal indexes. It does not change financial write functions, wallet balances or RLS policies. Browser roles cannot execute the new functions. All subjects/account keys are supplied by the verified backend context. No cloud migration was applied in this task.

Configuration/docs: `.env.example`, `package.json`, `README.md`, `IMPLEMENTATION.md`, `AUTH0_SETUP.md`, `supabase/README.md`, this report and the safe measurement artifacts. New optional settings are `SUPABASE_REQUEST_TIMEOUT_MS=8000` and development-only `PERFORMANCE_DIAGNOSTICS=false`. Existing actual credentials and local enable flags were not edited.

## Tests and results

| Verification | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 240 tests passed in 41 files |
| `npm run test:e2e -- --workers=4` | 26 Chromium tests passed in the final complete run |
| `npm run build` | Passed |
| `npm run check:auth-build` | Passed: production assets exclude fixture entry points; all six protected views require sign-in at desktop/mobile widths despite forged storage/return parameters |
| `npm run check:startup` | Passed: one critical request, three database reads, no returning-user initialization or auxiliary writes |
| Final migration regression | Five PostgreSQL/PGlite projection/pagination/ownership/grant tests passed after the final index change |

New coverage includes `tests/bootstrap.test.ts`, `tests/progressive-loading.test.tsx`, `tests/progressive-database.test.ts`, `tests/startup-tokens.test.ts`, `tests/database-timeout.test.ts`, `tests/startup-performance.test.ts` and `tests/e2e/startup.spec.ts`. Existing auth, onboarding, account, API/cache, funding, finance, reports, market and responsive fixtures were updated for the new endpoints.

Tests cover first-user onboarding, returning users, SDK callback/reload, missing profiles and wallets, strict balance validation, blocked unauthenticated routes, token expiry/renewal/subject mismatch, stalled restoration, database timeout, bounded network failure, successful retry, failed background reads, cancellation, account switching, complete-ledger totals and stable filtered pagination. Existing SQL funding, purchases, round-ups, refunds, conversions and report tests remain passing. No anonymous wallet, test entry route or fabricated production data was added.

## Reproduce safe diagnostics

Run `npm run check:startup` for the current controlled benchmark; its temporary JSON output is `test-results/startup-after.json`. The committed before artifact is the historical measurement captured before the edits, not an emulation of the old path using the new server. Run browser tests for current SDK/callback and progressive-loading traces.

Set `PERFORMANCE_DIAGNOSTICS=true` on the development server to see fixed-label `Server-Timing` headers for authentication, profile lookup and essential reads. In development browser tools, inspect `performance.getEntriesByType('measure').filter(e => e.name.startsWith('dpb:'))`. These entries contain static labels and durations only. They never contain JWTs, API keys, subjects, email addresses, balances, request bodies or user rows. Server timing headers are disabled in production even if the flag is set.

## External boundary and remaining limits

The current local configuration has Auth0 enabled and Supabase disabled. Therefore live authenticated Supabase/dashboard latency was not measured; no production latency guarantee is made. Configure the intended database and apply the new read migration before using these endpoints against it. Existing setup limitations from the funding task are not resolved or hidden by this performance change.

Cloud RLS/merchant acceptance, external Auth0 sign-in and real provider latency remain external verification steps. The database tests execute actual migrations locally; the browser tests use controlled provider/API responses. Very large auxiliary goal/notification lists and complete-ledger dashboard aggregates can still take time, but they run outside the essential wallet path. Explicit server report generation still reads the ledger required for accurate financial calculations. No financial calculation or authorization was weakened to obtain these measurements.
