# Dream Piggy Bank

A working, multi-currency wallet prototype for the PayPal AI Hackathon. React/TypeScript and Vite provide the responsive six-page interface; an Express API owns the ledger, savings rules, rate observations and integration credentials.

**All wallet balances and exchanges are simulated.** PMA observations are real indicative source data when available. Gemini explanations are labeled. PayPal Sandbox checkout is a separate USD merchant-payment demonstration and never changes the simulated wallet balance.

For the Auth0/PostgreSQL setup, see [Supabase setup](supabase/README.md). The [technical audit](AUDIT_REPORT.md) lists verified behavior, repairs, and remaining deployment blockers. Authenticated accounts initialize with zero balances; fictional opening balances are restricted to the isolated demo.

## Run locally

Requires Node.js **24.18 or newer** (the local store uses `node:sqlite`) and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` only if you have not already configured `.env.local`. Local precedence is process environment, `.env.local`, `.env`, then `.env.auth0`; an existing `.env.local` overrides example/demo flags. Open **http://127.0.0.1:5173**. The API listens on 127.0.0.1:3001. Use that exact frontend origin, or update `APP_ORIGIN` if you change it.

To explore without signing in, add this explicit opt-in to `.env.local` and restart `npm run dev`:

```env
VITE_ENABLE_DEMO_MODE=true
```

Click **Explore Dream Piggy Bank (Demo Mode)** beneath the login options. Auth0, PayPal and Supabase credentials are not required for this local mode. All six pages are available; the profile is under Settings. Wallet balances, purchases, goals, reports and financial operations are simulated. Real Twelve Data Forex is the default price source; simulated samples require explicit selection. Purchases, round-ups, refunds, goals, savings rules, conversions and preferences update only this browser tab's namespaced session storage (`walletwise:developer-demo:v1`). Refresh preserves the session; **Exit Demo Mode** in the sidebar or Settings clears it and returns to login. Browser session restoration may retain session storage; use Exit Demo Mode to clear it.

The gate requires both Vite development mode and the exact flag `true`. Production builds exclude the demo entry button, sample seed and data service, even if the flag is enabled at build time. The former anonymous API/cookie demo has been removed: private APIs always require a verified Auth0 or Firebase token, independently of frontend flags. Demo state never migrates into authenticated accounts. Auth0, PayPal credentials and Supabase RLS remain unchanged.

Demo journey:

1. Explore Home, My Wallet, Smart Savings, Currency Rates, Reports and Settings. Sample goals and round-ups are enabled initially.
2. Create and select a goal, then simulate an ILS 23.40 purchase. At the default ILS rule, spendable funds decrease by 25.00 and savings increase by 1.60.
3. Generate a report, then accept or dismiss a proposed savings rule.
4. In Currency Rates, use **Real Forex (Twelve Data)** or explicitly select **Simulated sample rates**. Preview an exchange and confirm the local simulated conversion. Currency alerts produce local notifications against the selected observations.
5. Inspect a purchase in My Wallet and refund it. Its purchase and original savings allocation reverse exactly once.
6. Adjust preferences, reload to verify tab persistence, then exit to clear the demo.

Goal editing and partial refunds are not implemented in the existing application. PayPal checkout is disabled in Developer Demo Mode. Insights use shared local calculations and labeled sample explanations; no live Gemini request is made. See [the implementation report](DEMO_MODE_REPORT.md) for files and validation.

## Architecture

| Location                      | Responsibility                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `src/`                        | React interface, accessible dialogs, mobile navigation, API/auth client                  |
| `shared/money.ts`             | Integer minor-unit parsing, formatting, round-ups, fixed-point rates, BigInt conversions |
| `shared/types.ts`             | Typed ledger, profiles, goals, alerts, rate observations, reports and Sandbox references |
| `server/ledger.ts`            | Balanced postings, derived balances, atomic allocation/refund rules and idempotency      |
| `server/store.ts`             | SQLite transactions locally, optional Firestore transactions for hosted deployments      |
| `server/app.ts`               | Validated APIs, verified sessions, origin/header checks, rate limits and authorization   |
| `server/rates.ts`             | Official PMA embed parser, observation storage, staleness and threshold alerts           |
| `server/reports.ts`           | Deterministic aggregates, period changes, replay estimates and goal progress             |
| `server/ai.ts`                | Shared schema-validated, time-limited Gemini explanations with deterministic fallback    |
| `server/currency-insights.ts` | Personalized conversion impact, stored historical ranges and optional AI explanation     |
| `server/paypal.ts`            | Sandbox-only OAuth, official Orders API requests and capture validation                  |
| `api/index.ts`, `vercel.json` | Vercel API entry, frontend routing and daily rate-refresh cron                           |
| `tests/`                      | Financial, integration, API, component and Playwright journeys                           |

The stack includes Tailwind CSS, Lucide, Zod, Helmet, Firebase SDKs, Vitest, React Testing Library and Playwright. There are no client-supplied balances or trusted user IDs. Firebase IDs come from verified tokens; Developer Demo Mode uses only tab-local state and never calls private APIs. Every user endpoint scopes records to that verified identity.

### Ledger rules

- ILS/USD use 100 minor units per unit; JOD uses 1,000. User amounts are parsed from decimal strings. Monetary multiplication/division uses BigInt rational arithmetic, then half-up rounding to the destination minor unit. Rates are stored in millionths. Display-only percentages and chart coordinates use numbers.
- Each entry has available, savings and external-counterparty postings that sum to zero **within each currency**. Spendable and saved amounts cannot overlap. Balances are derived from persisted postings.
- Defaults: ILS rounds to 5.00, USD to 1.00, JOD to 1.000. Exact multiples save zero. Configurable caps limit allocation per purchase.
- A purchase and its savings commit together. If either cannot be funded, neither is recorded. Canceling a form makes no request. Failed requests allocate nothing.
- Full refunds reverse the exact original postings and goal allocation, independent of the current rule. Partial refunds are not supported. Refunds themselves are idempotent.
- Goal selection is currency-specific and affects future allocations only. Existing allocations stay in their original goal (or unassigned jar).
- Mutations use UUID request identifiers and saved payload fingerprints. Duplicate identical requests return the original result; changed payloads with the same identifier are rejected. SQLite `BEGIN IMMEDIATE` and Firestore transactions serialize balance changes.
- Conversion confirmation revalidates the server's latest snapshot, amount, balance, rate and five-minute preview window. Stale observations older than 36 hours block new conversions. No actual exchange fees are charged or invented in the simulated ledger.

## Configuration

Copy `.env.example`; do not commit credentials. **None of the integration secrets use `VITE_` or reach the browser.**

| Variable                                   | Purpose                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ORIGIN`                               | Exact allowed browser origin, including scheme and port                           |
| `PORT`                                     | Local API port, default 3001                                                      |
| `VITE_ENABLE_DEMO_MODE`                    | Explicit local frontend opt-in; requires Vite DEV and has no effect on backend authentication |
| `STORAGE`                                  | `sqlite` locally; `firestore` required on Vercel                                  |
| `DATABASE_PATH`                            | Local SQLite file path                                                            |
| `FIREBASE_SERVICE_ACCOUNT`                 | Server-side service-account JSON with access to your Firestore project            |
| `FIREBASE_WEB_API_KEY`                     | Public Firebase web-app configuration, returned only as client auth configuration |
| `FIREBASE_AUTH_DOMAIN`                     | Firebase web-app auth domain                                                      |
| `FIREBASE_PROJECT_ID`                      | Firebase project ID                                                               |
| `GEMINI_API_KEY`                           | Server-side Google AI API key                                                     |
| `GEMINI_MODEL`                             | Available `generateContent` model ID; default `gemini-2.5-flash`                  |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | **Sandbox** REST application credentials                                          |
| `CRON_SECRET`                              | Strong random secret used for the protected scheduled endpoint                    |
| `DISABLE_RATE_JOB`                         | Set `true` for deterministic local tests                                          |

### Firebase

1. Create a Firebase project and register a web application.
2. Enable Email/Password in Authentication and add your local/production domains to Authorized domains.
3. Create a Firestore database. Deploy `firestore.rules`: direct browser reads/writes are denied; the authenticated backend is the only data access path.
4. Supply the service-account JSON and three web configuration variables above. Set `STORAGE=firestore` to use Firestore; Firebase authentication can also be used with local SQLite.
5. With Firebase configured and Auth0 disabled, sign in or create an account through the wallet entry form. Firebase provides persistent authentication; the backend verifies every ID token (including revocation). Authenticated and demo accounts have separate records; there is no automatic migration.

The prototype stores each user's aggregate in one Firestore document so each wallet operation is transactional. This is deliberately bounded hackathon storage, not a production ledger: Firestore has a 1 MiB document limit. Large histories require normalized transaction collections, bounded idempotency storage and indexed/paginated reads before public-scale deployment. Service-account credentials are never stored in the browser or repository.

### Gemini

Provide `GEMINI_API_KEY` and an enabled `GEMINI_MODEL`. Reports use rolling 7-day or 30-day periods. Aggregates are computed from recorded, non-refunded purchases; previous periods are compared only if the account existed throughout the preceding period. Reports are generated **on demand**, and up to 24 are retained.

Only computed currency/category totals, anonymized goal amounts and at most two rate observations are sent to Gemini. Merchant descriptions, names, user IDs and goal names are excluded. Structured JSON is schema-validated, responses are time-limited, and the report endpoint is rate-limited. Failed, malformed or unavailable responses fall back to labeled deterministic summaries. AI text is rendered as text, never HTML or executable instructions.

Round-up estimates replay historical purchases under both the current and suggested increments using the recorded cap. The estimate assumes sufficient spendable funds and is not a forecast. Only an explicit Accept action changes the user's rule. Acceptance is rejected if the increment, cap, activation status or ledger revision changed since generation; generate a new report in that case. Reports show saved goal progress and server-calculated absolute/percentage spending changes; a zero previous-period baseline never produces an invented percentage.

Currency Rates also has a standalone personalized explanation. Select a pair and amount, or leave the amount empty to use the server-owned available balance. The server calculates indicative received value, reference-value change, percentage movement and the observed historical range. Gemini receives those computed facts, never instructions to perform financial arithmetic. When unavailable, the same facts have deterministic explanations. A single observation yields no trend claim; stale source data is explicitly labeled. Analysis does not move funds. Changing an input invalidates its result; delayed analysis or conversion-preview responses cannot overwrite newer inputs.

Reference: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

### PMA currency provider and alerts

Official references: [PMA currency rates](https://www.pma.ps/currency-exchange-rates) and [PMA public embed](https://wcur.pma.ps/webtools/currency/embed).

No documented official public JSON API was identified. The server adapter reads the public embeddable table at the verified URL; no undocumented endpoint is assumed. Requests time out after 12 seconds and successful observations are cached for six hours. The `/robots.txt` endpoint was unavailable during verification; no access restrictions are bypassed. Confirm continued permitted usage and publication terms with PMA before a public production deployment. The adapter fails closed when required pairs or numeric formats change.

PMA publishes USD/ILS and JOD/ILS bid/ask fields. During verification, its displayed bid exceeded ask for both pairs. Dream Piggy Bank **preserves the source labels** and makes no claim that those values are executable prices. It uses a clearly labeled midpoint, then derives inverses/cross-rates with fixed-point arithmetic. The source supplies no publication timestamp: `publishedAt` is null and the app shows retrieval time. A fresh retrieval does not prove the underlying source published a new rate.

Only successfully fetched observations populate history (up to 366 retained). No artificial chart points or fallback market rates are created. Source failures leave older observations visible, with stale conversions blocked. Run `npx tsx scripts/check-pma.ts` to perform a live provider smoke check.

The local server checks on startup and every six hours while running. Vercel invokes `/api/cron` daily at 08:00 UTC using `CRON_SECRET`; this is compatible with daily indicative data and a daily cron tier. Alerts are evaluated on the server for all stored users, even without an open browser. Each alert supports direction, percentage/absolute threshold, optional watched amount, pause/resume, a 24-hour cooldown and reference reset. In-app notices retain read state. Disabling notifications suppresses delivery while still updating triggered references. No browser push or external messages are sent. Scheduled operation requires the local server to stay running or Vercel Cron to be configured.

### PayPal Sandbox

1. Create a Sandbox REST app in the [PayPal developer dashboard](https://developer.paypal.com/dashboard/).
2. Set its Sandbox client ID and client secret server-side. No production API base URL is configurable: requests go exclusively to `https://api-m.sandbox.paypal.com`.
3. In My Wallet, start the **USD 1.00** checkout demonstration, approve it with a Sandbox buyer, and return to the app.
4. The backend verifies order ownership, retrieves the order to reconcile a potentially lost capture response, captures when needed, and verifies capture ID, status, currency and exact amount before recording completion.

Created, canceled, pending, failed and completed captures are distinguished. Order/capture identifiers are retained. OAuth/request timeouts, stable PayPal request IDs and local deduplication protect retries. Pending payments can be rechecked with Verify capture. No webhook is used; therefore no unverified webhook is accepted. Sandbox activity is displayed separately and cannot fund the wallet or create round-ups.

The official [currency list](https://developer.paypal.com/api/codes/currency) includes ILS/USD and does not list JOD. This checkout intentionally restricts the demo to USD. See [Orders integration](https://developer.paypal.com/whats-an-order/). Sandbox merchant checkout is not banking, custody, a wallet top-up API or a peer-to-peer transfer service.

## Tests and production build

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

Unit and API tests use `data/test.db`; Playwright uses `data/e2e.db` when it starts its own server. Playwright uses fresh browser sessions and does not seed fictitious activity into the normal wallet. Stop an existing development server before E2E testing if you want guaranteed test-database separation. Tests of third-party responses use explicitly isolated fixtures; they do not claim credentialed integration success.

Local production preview after build:

```powershell
$env:NODE_ENV='production'
$env:APP_ORIGIN='http://127.0.0.1:3001'
npm start
```

For Vercel, import this repository, select Node 24, set `STORAGE=firestore`, configure Firebase credentials, `APP_ORIGIN=https://your-domain`, `CRON_SECRET`, and optional Gemini/PayPal credentials. `vercel.json` builds the Vite frontend and routes APIs to Express. SQLite is explicitly refused on Vercel because ephemeral storage cannot safely persist balances. Private APIs always require sign-in; frontend demo flags do not authorize API access. Deploy the Firestore rules separately in Firebase. A deployment has not been published by this implementation.

## Prototype limits

- No real balances, transfers, trading, custody, withdrawals or financial guarantees.
- Credentials are required to verify live Firebase, Gemini and PayPal behavior; automated fixtures cover their failure and validation paths, not account eligibility.
- No partial refunds, cross-currency savings goals, push notifications or automatic scheduled AI report delivery. Auth0 email password-reset requests are supported.
- Rate history begins with the first real retrieval; missing PMA publication dates cannot be reconstructed.
- Shared transactional rate limits are implemented; load-test Firestore contention, quotas and sharding before production traffic. The cron iterates user documents and needs pagination/queuing at scale.
- The single-document Firestore model and retained idempotency map need production scaling work. This is a demonstrable MVP, not a regulated financial service.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the phase-by-phase file and validation record.

## Auth0 authentication

See [AUTH0_SETUP.md](AUTH0_SETUP.md) for the implemented Auth0 integration, required tenant setup, production URLs, session behavior, and PayPal social login requirements. Local Auth0 mode is configured in ignored `.env.auth0`; the Auth0 API and connections need the documented dashboard setup before live login succeeds.


## Reliability, public pages and privacy

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the current audit, cache/limit architecture, deployment requirements, legal owner decisions and changed-file inventory. Historical audit reports describe their original snapshots; this report supersedes their caching, rate-limit and branding notes.

The display name and npm slug are **Dream Piggy Bank** / `dream-piggy-bank`. Existing Auth0 applications/connections, Supabase RPC/table identifiers, Firebase collection, `X-WalletWise` request header, `WALLETWISE_*` configuration and `walletwise:developer-demo:v1` storage key are intentionally preserved for compatibility. No account data migration or reset is performed.

Public routes `/about`, `/help`, `/privacy-policy`, `/terms-of-use`, `/acceptable-use`, `/cookie-policy`, `/disclaimer`, `/contact` and `/storage-preferences` load without authentication. Help has searchable articles, categories, FAQs and app links. Unknown pathnames display a branded 404; existing wallet navigation remains hash based. Static SPA hosting returns the shell HTTP status for public/error pages; API errors retain their real HTTP statuses.

Only essential application storage was found: Auth0's existing local-storage cache/necessary provider cookies, and tab-local development demo session storage. No optional analytics or marketing code or consent record is introduced. Storage preferences explain these mechanisms and browser/provider management. The operator must separately audit tenant-level scripts before deployment.

`src/requestCache.ts` deduplicates concurrent private GETs in memory and uses a fresh generation on provider/account transitions. State has a configurable 1.5-second freshness window; every write invalidates pending and cached reads before and after completion. Obsolete reads are aborted. No private cache is persisted. Window focus revalidates without replacing loaded content with skeletons. Reads retry a network failure once; mutations are never automatically retried. HTTP 429 responses impose the supplied cooldown and never trigger an immediate retry. Auth0 sign-out/demo transitions clear the application cache; Auth0 continues to own its session storage.

Server counters, AI explanation reuse, and concurrency leases use **existing transactional SQLite / Firestore storage**, not process-local production counters. No new cloud service is required. Read/profile/financial/AI/payment/refresh limits have separate configurable buckets; verified accounts determine private keys, and trusted platform/socket IP determines the entry bucket. Shared Gemini quota and concurrency controls are checked only for uncached provider work. A storage failure fails protected requests closed with 503. Limits return JSON 429, `Retry-After`, and a non-sensitive request reference. The frontend cooldown is feedback, not enforcement.

PMA refreshes retain the six-hour default TTL and stored history, with configurable stale thresholds, local promise deduplication and a shared provider lease. Failed fetches never invent data. AI cache keys include account scope, report frequency, financial fingerprint, calculated facts, model and prompt version. Cached explanation timestamps are labeled; financial summaries and recommendations are rebuilt. Provider failures use calculated fallbacks and are not cached as successful AI output. Cache expiry stops reuse; physical retention is an operator housekeeping concern.

Loading components preserve dashboard grids, wallet rows, goals/details, charts, profiles/settings and report shapes. Existing loaded data stays visible during background refreshes. Branded errors cover 401/403/404/429/500/503 and a React boundary provides recovery from render failures. Backend unexpected errors no longer forward arbitrary exception text.

The authenticated wallet and public information module are lazy-loaded; the legacy Firebase browser SDK is imported only for its configured legacy flow. Provider chunks are split for caching. Transaction history is fetched in existing database batches; UI filters remain client-side. End-to-end pagination of complete wallet state is not implemented because reports and ledger calculations currently require its full history.

The deployment has no configured support or privacy contact, operator identity, legal jurisdiction or universal deletion/retention workflow. The public notices say this explicitly. These are owner/legal review requirements before a public production launch, not claims of compliance.


## Twelve Data Forex upgrade

See [FOREX_INTEGRATION.md](FOREX_INTEGRATION.md) for verified pair coverage, activation, quota arithmetic, the new Supabase migration, Cron recipe, timestamps, source handling and test/live-verification boundaries.

Set server-only `TWELVE_DATA_API_KEY` and `MARKET_DATA_PROVIDER=twelve` after obtaining the required pair and display/storage entitlements. Apply `supabase/migrations/202610290001_forex_snapshots.sql` to the configured Supabase project first. No key belongs in Vite or browser code. Legacy PMA remains selected by default for existing configurations and is never silently substituted into a configured Twelve Data feed.

Default shared polling is every five minutes (two quote credits per cycle, at most 576/day). A suitable licensed account can use `FOREX_POLL_MS=60000`, with daily/minute budgets matching the actual subscription (two symbols every minute consume 2,880 quote credits/day). Browsers read the shared backend every 30 seconds and recover with backoff; the provider cache and shared lease prevent per-user upstream requests. There is no persistent WebSocket worker in this serverless architecture.

The long-running local server polls automatically. On Vercel, active clients also trigger due shared checks; use the optional Vault-backed Supabase Cron recipe in `supabase/forex-cron.sql` for collection without connected clients. No cloud job or migration was deployed by this implementation. Existing daily Vercel Cron alone is insufficient for minute-level history.

`npm run check:forex` verifies the real public symbol directory. If a server key is configured, it additionally performs two authenticated quote reads without persisting data or changing wallet balances. That optional probe consumes two provider credits and cannot establish storage/display rights or independent price accuracy. Without a key it explicitly skips price verification.

## Real Forex in Developer Demo Mode

See [DEMO_FOREX_REPORT.md](DEMO_FOREX_REPORT.md) for current account verification, configuration and isolation details. This supersedes earlier claims that all demo prices are simulated or all demo actions are offline. Real-rate demos read only the development-only public market service, with credentials omitted. Financial operations remain local and private APIs remain protected. Missing provider configuration shows unavailable rates; samples require separate selection. The public endpoint shares provider caches/quotas and has a dedicated server IP limit (RATE_LIMIT_PUBLIC_MARKET, default 30/minute). It is disabled in production/Vercel. Confirm provider display permissions before sharing a local demo externally.
