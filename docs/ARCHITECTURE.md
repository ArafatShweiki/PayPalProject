# Architecture

## Repository map

| Path             | Responsibility                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `src/`           | React screens, Auth0 boundary, API/cache adapters, progressive loading and styles                  |
| `server/`        | Express routes, verified identity, Supabase services, ledger orchestration and provider adapters   |
| `shared/`        | Typed domain contracts, minor-unit arithmetic, report periods, savings/coach/market calculations   |
| `api/index.ts`   | Vercel entry exporting the existing Express app                                                    |
| `supabase/`      | Immutable migration history, guarded bootstrap, diagnostics, optional cron recipe and SQL tests    |
| `scripts/`       | Build/security/runtime checks, read-only diagnostics, legacy migration tools and PostgreSQL runner |
| `tests/`         | Unit, component, API, SQL, local browser, production-artifact and guarded live tests               |
| `auth0-actions/` | Auth0 Post Login Action for the Supabase authenticated role                                        |

## Request and identity flow

Public configuration loads before Auth0. The official SDK handles PKCE, state/nonce, callback processing, session renewal and logout. The app requests no custom API audience. Its app-bound ID token supplies the existing first-party Express endpoints and Supabase third-party Auth integration; this is not a general-purpose OAuth resource server. The backend verifies RS256/JWKS, issuer, client-ID audience, expiry, issued-at, subject, authorized party when required and the authenticated role.

Identity follows the opaque Auth0 subject; auxiliary IDs use the existing issuer/subject mapping. Matching email addresses never merge accounts. Email and PayPal sign-in have the same application permissions. PayPal sign-in does not fund a wallet or import PayPal balances.

One authenticated `/api/bootstrap` request returns the owned onboarding decision, balances and savings rules. Existing accounts are not reinitialized. Dashboard summaries, the first activity page and market observations load independently afterward. Activity filters run before cursor pagination; reports and timelines page separately. Explicit report calculations still load the data needed for complete results.

Missing financial data produces a recoverable error. Private browser caches are scoped to the current authentication generation, canceled/cleared on account changes and invalidated around financial mutations. They never become authoritative balances. Opt-in development timing uses fixed `dpb:` labels and safe durations, not user data.

## Persistence and financial operations

Supabase is authoritative for wallets, transactions, balanced ledger postings, savings allocations, Circle membership/shares/votes, funding and reports. Versioned owner-scoped `account_state` stores supporting preferences, goals, alerts and notices. Reads may import an existing verified identity's legacy auxiliary record once; originals remain intact and no financial opening balance is invented.

SQL functions validate ownership, precision, replay fingerprints and nonnegative balances while locking the relevant rows. USD/ILS use hundredths; JOD uses thousandths. Transactions commit postings and balances together. Retries with the original request identity cannot create extra money. Security details are in [SECURITY.md](SECURITY.md).

Smart Savings has one explicit eligible personal-goal or Circle destination. Changing it directs future allocations; historical savings stay in their recorded destinations. Only the round-up converts in a cross-currency purchase, using the saved authenticated quote. Historical unassigned savings require an explicit same-currency assignment. Orphaned references stay in `savings_reconciliation_issues` for review; that diagnostic queue is not a balance.

Archiving retains personal goal funds/history. Deleting a personal goal returns its allocated funds atomically to its same-currency available wallet, pauses an affected default and retains ledger references; later refunds cannot return the same savings twice. This requires migration `202611080001_delete_savings_goal.sql`.

Circle balances equal the signed member shares. A proposal fixes its terms and positive-share contributor snapshot, permits one active reservation and pauses additional contributions. Every required contributor explicitly approves before owner execution; rejection/expiry prevents execution. Personal purchase refunds cannot withdraw Circle contributions. Membership is required for private Circle data, and invitation preview alone grants no membership. Tokens are random, hashed at rest, expire after seven days and can be revoked. The timeline pages durable events; detail projections may show only a recent subset. Milestones are awarded once per Circle lifetime, including after target changes.

## Providers and supporting storage

PayPal funding reserves an owned durable request, creates a Sandbox order and verifies its canonical merchant, amount, currency, identifiers and completed capture before one atomic credit. Funding is neither spending nor savings income. Status reconciliation recovers interrupted outcomes. See [setup and funding recovery](SETUP.md).

Reports calculate per-currency totals and recommendation candidates before optional Gemini interpretation. Weekly periods are seven local calendar days; monthly periods are calendar months. Historical refund cutoffs differ from Home's recorded-date net spending: a refund-only month can legitimately have negative net spending. Inclusive savings totals contain personal savings plus only the current user's Circle shares. Subsets must not be added again.

The Coach reads a coherent owned SQL snapshot. A pace estimate requires fourteen days and three positive contributions on two UTC dates; reversals/outflows affect net pace and historical assignments do not inflate it. Constant pace and hypothetical dates are assumptions. Gemini receives calculated anonymous facts and cannot supply arithmetic, execute money operations or silently change settings. Recommendations require explicit review and current rule/destination/ledger checks.

PMA is the default indicative market provider; optional Twelve Data uses verified direct/inverse legs and deterministic crosses. Observations keep their source/time; missing history is not backfilled. Provider failure retains marked stale observations and blocks stale financial quotes rather than switching providers silently. Alerts are based on actual observations, deduplicated and subject to preferences/cooldowns.

Shared caches, limits, quotas, provider metadata and expiring fenced leases use service-only Supabase RPCs. CAS updates and database-time lease ownership prevent stale workers publishing after a successor takes over. Cleanup removes bounded expired infrastructure, never financial history or durable observations. SQLite remains explicit local/test storage; Vercel rejects it. Legacy migration tools remain for recovery, without a Firebase runtime requirement.

## Deployment boundary

Vite builds only the browser. Vercel serves `dist` and imports `api/index.ts`; the local `server/index.ts` listener and interval do not run in the function. Explicit `.js` imports and NodeNext checking are required for emitted Node ESM. Daily authenticated cron and user-triggered shared due checks provide serverless refresh; no continuous stream or persistent polling worker is deployed.

See [DEPLOYMENT.md](DEPLOYMENT.md) for routing, duration, cron and scaling limitations, and [TESTING.md](TESTING.md) for what each test layer establishes.
