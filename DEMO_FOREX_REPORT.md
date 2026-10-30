# Developer Demo Mode — real Forex

Verified locally: 29 October 2026.

## Result and account access

New demo sessions default to **Real Forex (Twelve Data)**. Currency Rates retains its existing layout, with a source selector for the separately selected **Simulated sample rates** mode. Missing credentials and provider errors show an unavailable state rather than fabricated prices. Provider, quote time, direct/inverse/cross method and freshness remain visible; the existing market hook polls automatically.

The current server-side Twelve Data key successfully retrieved both required pairs from the official quote endpoint:

| Pair | Actual provider result |
| --- | --- |
| USD/ILS | HTTP 200; matching symbol, decimal price and market timestamp |
| USD/JOD | HTTP 200; matching symbol, decimal price and market timestamp |

An actual local application smoke check also returned HTTP 200 with connected Twelve Data status and both genuine pair quotes through `/api/market-data/live`. Unauthenticated `/api/state` remained **401**; POST to the public market route returned **405**. No key was printed or sent to a browser. The direct pair probe used two provider quote reads; the application endpoint reused the shared provider cache and quota schedule.

The local key is present, `MARKET_DATA_PROVIDER=twelve` and `VITE_ENABLE_DEMO_MODE=true`. **No required local Forex configuration is missing.** Supabase is disabled locally; the supported SQLite cache works without enabling it. No `.env.local` credentials were changed. A successful quote request proves pair access at the time checked, not independent price accuracy or contractual display rights.

## Isolation, cache and quotas

- `server/public-market.ts` exposes fixed GET/HEAD live/history paths only. It is mounted before normal authentication but never initializes or reads users, profiles, notices or wallets. It calls `refreshForex`, rather than the authenticated alert-processing `refreshRates` path. Snapshot fields are explicitly whitelisted.
- The existing API entry limit and a separate source-IP limit apply. `RATE_LIMIT_PUBLIC_MARKET` defaults to 30 reads per minute. The client respects Retry-After. Refresh shares the normal backend cache, provider polling interval, credit budgets, lease and outage backoff; it cannot force requests past provider quotas.
- `src/publicMarket.ts` only sends fixed public GETs with credentials omitted, no authorization header, no request body and no provider key. Pending reads use the shared public request cache. Demo financial operations retain the local dispatcher and never call private APIs.
- Anonymous market routes require the existing server demo flag, non-production NODE_ENV and no VERCEL environment. They return 404 in production/Vercel, even if the demo flag is set. Unknown routes return 404 and mutation methods return 405.
- Auth0, Supabase authorization, PayPal and authenticated financial endpoints were not changed.

USD/ILS and USD/JOD retain actual provider values and observation times. Inverse/cross calculations use the existing shared fixed-point helpers. Wallet balances, purchases, savings and conversions remain simulated and local. Conversions enforce sufficient simulated funds, freshness, expiry and idempotency; switching rate sources clears a pending converter preview. Local demo alerts may evaluate received observations and produce local notices only.

Old demo sessions without an explicit rate source migrate to real-rate mode while preserving financial records. The selected mode persists; live quote buffers remain in memory. Source/session generation checks prevent late responses from replacing selected samples or recreating cleared session storage after exit.

## Configuration and licensing

For a fresh local setup:

```env
VITE_ENABLE_DEMO_MODE=true
MARKET_DATA_PROVIDER=twelve
TWELVE_DATA_API_KEY=your-server-only-key
RATE_LIMIT_PUBLIC_MARKET=30
```

Never prefix the provider key with VITE_. Restart the local API after server configuration changes. Reload an already-open demo after upgrading its transport. Existing Forex polling/freshness and credit settings remain documented in [FOREX_INTEGRATION.md](FOREX_INTEGRATION.md); this change does not increase those budgets or require a new dependency.

The public route is development-only. API access does not establish external display/redistribution permissions. The account's contractual rights were not independently verified. Confirm the applicable agreement before sharing a local demo externally; production anonymous distribution remains disabled. See [Twelve Data's commercial and personal usage guidance](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage).

## Validation

Automated tests cover public field whitelisting, private-record isolation, method restrictions, rate limits, missing configuration, production/Vercel gates, credential rotation, public-only demo reads, local conversion, unavailable rates, explicit samples, source switching and late responses after exit. Browser tests cover automatic quote updates, refresh, unavailable-to-sample switching and absence of private demo requests. Browser market quotes are controlled fixtures; the live account probes above were separate actual provider requests.

Executed results:

| Check | Result |
| --- | --- |
| `npm test` | 165 passed across 29 files |
| `npm run test:e2e` | All 22 browser tests passed |
| Focused demo browser rerun after final labeling corrections | 2 passed |
| `npm run lint` | Passed |
| TypeScript (`tsc --noEmit`, included in build) | Passed |
| `npm run build` | Passed |
| `npm run check:demo-build` | Passed; production demo code/seed/entry excluded, forged storage rejected |

No deployment, schema migration, real financial transaction or external message was performed.
