# Dream Piggy Bank — Forex integration report and setup

Reviewed: 29 October 2026. Wallet balances, round-ups and conversions remain simulated. No stock trading, real-money exchange, payment or cloud deployment was introduced.

## Provider investigation and live-verification boundary

The real Twelve Data `/forex_pairs` directory was fetched successfully with `npm run check:forex`. It listed **USD/ILS, USD/JOD, ILS/USD and JOD/USD**. It did **not** list JOD/ILS or ILS/JOD in that response. This verifies directory coverage only; it does not prove that a particular subscription can retrieve each instrument from `/quote`, stream it, store it or display it to customers.

Twelve Data's Forex page describes minute-level updates, with streaming availability depending on instrument/account. API documentation identifies quote requests as one credit per symbol and recommends server-side `Authorization: apikey ...`. Its quote schema supplies a price and timestamp/last-minute quote time, with an optional market-open flag. The adapter labels the source as a provider quote, never as an invented bid, ask or executable midpoint.

**Updated account check:** the subsequently configured local Twelve Data key successfully retrieved both USD/ILS and USD/JOD with HTTP 200. That was a historical quote check; it was not repeated for the funding change. Current market reads require Auth0 sign-in. API success does not establish independent price accuracy or contractual display rights. No sample key, hardcoded peg, random price or PMA substitute is used in Twelve Data mode.

References: [official Forex product](https://twelvedata.com/forex), [API docs](https://twelvedata.com/docs), [pricing/credits](https://twelvedata.com/pricing), [commercial/personal use](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage), [business display plans](https://twelvedata.com/pricing-business), [WebSocket FAQ](https://support.twelvedata.com/en/articles/5194610-websocket-faq).

## Activation

1. Obtain a Twelve Data key whose account can read USD/ILS and USD/JOD quotes (or the verified inverses) and has the necessary data-storage/display rights. Directory membership alone does not grant these rights.
2. Apply `supabase/migrations/202610290001_forex_snapshots.sql` to your configured Supabase database. It creates a dedicated indexed market table with RLS, read-only authenticated access, service-only inserts and a service-only bucketed history function. Existing tables/RPCs/identities are preserved. The migration was executed in local PostgreSQL/PGlite tests, not your cloud database.
3. Configure server environment variables and restart/redeploy:

```env
MARKET_DATA_PROVIDER=twelve
TWELVE_DATA_API_KEY=your-server-only-key
FOREX_ILS_SYMBOL=USD/ILS
FOREX_JOD_SYMBOL=USD/JOD
FOREX_POLL_MS=300000
FOREX_STALE_MS=180000
FOREX_MAX_SKEW_MS=120000
TWELVE_DATA_MINUTE_CREDITS=8
TWELVE_DATA_DAILY_CREDITS=800
```

Do not add a `VITE_` prefix or send the key to the browser. The request URL contains only the symbol and precision; the key travels in the server's authorization header. Provider errors are mapped to safe messages, without returning raw provider payloads or credentials.

`MARKET_DATA_PROVIDER=pma` retains the explicit legacy indicative source. Missing/invalid Twelve Data credentials in selected Twelve Data mode produce an unavailable state, not a silent switch to PMA. Historical records from the two sources remain separate.

### Minute polling and plan requirements

For an appropriately licensed account:

```env
FOREX_POLL_MS=60000
FOREX_STALE_MS=180000
# Set these to the account's actual available budgets:
TWELVE_DATA_MINUTE_CREDITS=8
TWELVE_DATA_DAILY_CREDITS=3000
```

Two symbols every minute cost **2,880 quote credits per 24 hours**, before probes/other account activity. The documented Basic allowance of 800/day cannot support that continuously. The five-minute default uses at most **576 quote credits/day**; quotas, failures and inactive scheduling can reduce actual requests. These examples are limits for this application, not claims about the owner's subscription. Account usage by other applications still counts at the provider and may produce 429 responses.

Public/client-facing display and redistribution have licensing requirements beyond raw API access. Twelve Data describes individual plans as personal/internal/development use, business plans for external display, and separate agreements for redistribution. Confirm whether raw snapshot retention and calculated currency cross-rates are permitted for your use case. No subscription purchase or license approval was made. Do not assume a free or personal key authorizes a public fintech site.

## Shared update architecture

`server/forex.ts` implements one shared, quota-limited polling service. The existing durable transactional store holds a provider lease, next eligible request time, daily/minute counters, retry state and safe status. Local requests share a pending promise; separate instances respect the shared lease/cache. API users cannot force provider traffic past the shared schedule by pressing Refresh repeatedly.

A successful cycle requests both legs in parallel. Prices are validated as positive decimal strings and rounded half-up once to the existing millionth rate scale using BigInt arithmetic. Symbol identity and provider times are validated. Excessively skewed legs are rejected rather than combined misleadingly; default maximum skew is two minutes. A combined snapshot uses the older leg's time and retains each individual time. Out-of-order combined observations do not replace newer history. Identical quote payloads deduplicate instead of generating artificial price events.

Direct and inverse quote legs are supported. For canonical USD quotes, **JOD/ILS = (USD/ILS) / (USD/JOD)**; inverses use reciprocal fixed-point division. UI/conversions/AI use the same deterministic helpers. USD/JOD is not given artificial volatility just because it is pegged.

Provider 429, outages, invalid responses and persistence failures retain the last good observations and mark failures explicitly, with increasing retry delays. Configured daily/minute exhaustion is recorded before another request; daily exhaustion waits until the next UTC day. Market open/closed comes from the provider flag; absent flags mean unknown. No holiday calendar or clock-only status is invented. Old/weekend prices may remain visible but stale quotes cannot confirm a conversion. Effective stale age is at least twice the provider poll interval (ten minutes under the five-minute default; three minutes for the one-minute example).

`GET /api/rates/live` returns shared stored snapshots plus safe connection/source/retry status. `src/useMarketFeed.ts` polls every 30 seconds, pauses while hidden, reconnects after errors/online/visibility changes, respects client cooldowns and ignores canceled obsolete reads. The former public development endpoints and sample-rate generators are removed; all wallet market reads use the authenticated shared feed. Legacy PMA feed reads are less frequent and stay labeled PMA.

Fresh observations update wallet currency widgets and charts without a page reload. Only rates and the current account's in-app notices are merged into wallet state by background polling; successful financial mutations still perform the existing full state refresh/invalidation. Alert evaluation has a shared per-snapshot checkpoint and lease; each alert also records its last consumed snapshot to prevent duplicate notices.

### Scheduler and streaming choices

The long-running Node server uses its existing scheduler, now at the chosen provider interval. Vercel functions do not own a persistent WebSocket or reliable in-process interval. Active clients invoke shared due checks on that platform. The existing daily Vercel Cron remains unchanged.

For unattended collection, `supabase/forex-cron.sql` is an **optional deployment recipe**, not an automatically applied migration. Enable Supabase Cron, pg_net and Vault, store the API base URL as `dream_piggy_api_url` and existing CRON_SECRET as `dream_piggy_cron_secret`, and schedule the backend `/api/cron` request. The example is every five minutes; use every minute only when the backend interval, account quota and license support it. Monitor `cron.job_run_details` and HTTP responses. See [Supabase Cron](https://supabase.com/docs/guides/cron) and [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart).

WebSocket access was investigated, but **streaming is not implemented**: no key/streaming entitlement is configured, and the current serverless API cannot reliably keep a provider socket alive. A future licensed streaming deployment needs a single long-running ingestion worker, heartbeat/reconnect logic and shared persistence. Supabase Realtime was considered; authenticated backend polling was selected to preserve existing Auth0/RLS conventions without introducing client provider connections or a new publication requirement.

## History and persistence

With Supabase enabled, snapshots are persisted in `public.forex_snapshots`; without it, local SQLite provides the development equivalent. No market-data key is in a row. Status, quota and fenced lease coordination now use Supabase-only backend storage. PMA and Twelve Data observations share the existing forex_snapshots table with explicit provider isolation. Apply 202611060001_backend_storage.sql.

The wallet/feed carries a bounded recent buffer. A separate authenticated history endpoint supports **1h, 24h, 7d, 30d, 90d** using actual stored observations. The SQL function selects the last real observation in each time bucket (at most 500 points), preserving its original timestamp. It does not average or manufacture candles. Chart x positions use actual times, show coverage limits and show an unavailable state for fewer than two observations. No external time-series backfill is requested, so a new installation cannot display a full prior 90 days.

Local retention is bounded to 90 days/40,000 snapshots. Supabase retention is an operator responsibility; an optional 90-day cleanup job is commented in the Cron recipe and must be reviewed against licensing and retention policy. No cloud cleanup or deletion job was executed.

## Simulated conversions and alerts

Forex previews retrieve the latest acceptable shared quote, identify source/method/time, explicitly show zero simulated fee and spread, and expire within one minute or the remaining freshness window. Legacy PMA previews retain their existing expiry rules. Confirmation checks expiry, current acceptable source data and the actual approved rate. A changed price requires a new preview/confirmation; a later observation at the same price need not fail solely because the snapshot ID changed.

UI previews expire or clear when a received rate changes; this does not auto-execute or silently approve a replacement. Failed/uncertain confirmations keep the existing idempotency behavior. Server confirmations still use atomic balanced postings, enforce sufficient funds, persist quote provenance/rate/snapshot and reject duplicates or altered idempotency payloads. All wallets/conversions remain simulations; no fees, real transfer or payment were added.

Percentage and existing absolute-movement alerts remain supported. New target-rate alerts trigger an actual recorded crossing above/below the configured target. Per-observation duplicate prevention, notifications preferences and the 24-hour cooldown remain in force. A stale or missing quote does not fabricate a crossing. Alerts belong to the authenticated account and persist in Supabase.

AI inputs use actual deterministic observation calculations, quote/reference timestamps, conversion outcome differences and stored ranges. An optional monitoring threshold is derived deterministically from the largest adjacent recorded percentage change, rounded up to hundredths; it is labeled a monitoring reference, not a forecast. Currency AI is prompted for qualitative text only, and numeric/currency-symbol output is rejected in favor of computed explanations. AI cannot quote an unapproved price, mutate a rule or execute an exchange.

## Files and verification

New: `shared/market.ts`, `server/forex.ts`, `server/forex-store.ts`, `src/useMarketFeed.ts`, `src/MarketRates.tsx`, `supabase/migrations/202610290001_forex_snapshots.sql`, `supabase/forex-cron.sql`, `scripts/check-forex.ts`, Forex unit/API/component/browser tests, and this report.

Updated: shared types/currency facts, existing rate service/scheduler/API, database-state conversion metadata, currency insight service, App/dashboard/converter/rate UI, styles, `.env.example`, package scripts, README and factual help/privacy source descriptions. Existing authentication, RLS, PayPal, savings calculations and integration identifiers were preserved. No runtime dependency was added.

Final automated results are recorded below. No real payment, authenticated live quote request, cloud migration, Cron deployment or streaming subscription was performed. Known limitations are explicitly stated above rather than claimed as completed external integrations.

### Final executed verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: **154 passed in 27 files**. Includes provider parsing, future/skewed time rejection, direct/inverse/cross calculations, stale/closed handling, shared polling and unchanged-data deduplication, provider 429/backoff, configured budget exhaustion, missing-key behavior, private alert-feed isolation, atomic/idempotent conversions and overdraft/requote rejection. Existing financial/Auth0/Supabase tests also passed.
- PostgreSQL/PGlite executes the new migration and verifies stored market history, service-only writes/history function and authenticated read-only RLS. This is not a cloud Supabase smoke test.
- `npm run test:e2e`: **20 passed**. Covers automatic Forex widget/history updates, reconnect after a simulated outage, unavailable history, mobile overflow, all existing authentication, savings, conversion, report and help journeys and carousel interactions.
- `npm run build`: passed, including TypeScript. Largest JavaScript chunk remains approximately 248 kB; no large-chunk warning.
- `npm run check:forex`: passed against the **real public Twelve Data symbol directory**. Confirmed USD/ILS, USD/JOD and their inverses. **Authenticated quote probing was explicitly skipped because no key is configured.** No real received prices, paid entitlements, independent price accuracy, cloud persistence, cloud Cron or provider WebSocket were live-tested.
- Mobile Forex screenshot was inspected; browser layout tests also cover desktop/tablet/mobile application pages.

The initial SQL migration encoding issue and a test-only shared SQLite file conflict were corrected before these final passing runs. No production data was reset or test counter allowed to authorize a private account.

Current authentication and persistence architecture: [IMPLEMENTATION.md](IMPLEMENTATION.md). Sandbox funding does not change market-data licensing or quote calculations.
