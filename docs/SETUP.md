# Setup

## Local prerequisites

Use Node.js **24.x**, npm and the committed lockfile. Accounts require a configured Auth0 SPA and Supabase project. PayPal funding needs a Sandbox Business REST app/merchant and a distinct Sandbox Personal payer. Gemini and licensed Twelve Data access are optional integrations.

1. Run `npm ci`.
2. Copy `.env.example` to ignored `.env.local`, preserving any existing private settings. Fill the values below; never commit the file.
3. Apply only missing database migrations in the [documented order](../supabase/README.md).
4. Configure Auth0 and Supabase identity below, then run `npm run dev`.
5. Open `http://127.0.0.1:5173`; Express uses `http://127.0.0.1:3001`. A fresh account receives three zero-balance wallets after verified authentication.

Process variables override `.env.local`, then `.env`, then `.env.auth0`. Tests opt out of local credential loading. Vercel skips dotenv files and uses deployment settings. Restart after configuration changes. Do not replace a private environment file with the example once it contains your settings.

## Environment reference

[`.env.example`](../.env.example) lists all supported operational variables and defaults without credentials.

| Variables                                                        | Configuration                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                                     | Exact frontend origin; local `http://127.0.0.1:5173`, production HTTPS with no path/query/fragment. `VERCEL_URL` is the platform fallback.                                               |
| `AUTH0_ENABLED`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`               | `true`, tenant hostname and public SPA client ID.                                                                                                                                        |
| `AUTH0_DATABASE_CONNECTION`                                      | Existing email/password connection; default `Username-Password-Authentication`.                                                                                                          |
| `SUPABASE_ENABLED`, `SUPABASE_URL`                               | `true` and the intended project's URL.                                                                                                                                                   |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`                | Public browser key and private server key from the same project. Legacy aliases `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` remain accepted.                                       |
| `STORAGE`                                                        | `supabase` or unset with Supabase enabled. Explicit `sqlite` and `DATABASE_PATH` are isolated local/test settings only.                                                                  |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` | Matching Sandbox REST app and receiving Business merchant. The Client ID is public; the secret stays server-side.                                                                        |
| `PAYPAL_FUNDING_CURRENCIES`                                      | Default `USD`; add `ILS` only after that merchant's complete Sandbox flow succeeds. JOD is conversion-only.                                                                              |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                 | Optional server key/model. The example uses `gemini-3.5-flash-lite`; verify your account's access and compatibility with both report Interactions and explanation generateContent paths. |
| `CRON_SECRET`                                                    | Private random Bearer secret for `/api/cron`; configure separately in each environment.                                                                                                  |
| `MARKET_DATA_PROVIDER`, `TWELVE_DATA_API_KEY`                    | `pma` default or optional licensed `twelve`; its key is server-only.                                                                                                                     |
| `VITE_STATE_STALE_MS`                                            | Only build-time frontend setting; default 1500 ms, capped at 10 seconds.                                                                                                                 |

Runtime public configuration delivers Auth0 identifiers and Supabase URL/publishable key; authenticated funding configuration delivers the PayPal Client ID. Never use `VITE_` for a private credential. No SPA client secret, custom Auth0 API audience or Firebase credential is required.

Optional settings in the example cover Supabase/provider deadlines, AI cache/quota/concurrency, per-endpoint rate limits, funding cap, market freshness/provider budgets and diagnostics. Keep defaults unless there is a measured reason to tune them. `PORT`, `DISABLE_RATE_JOB`, `WALLETWISE_LOAD_ENV`, `DATABASE_PATH` and `WALLETWISE_API_TARGET` serve local/test workflows, not deployed durable storage. `PERFORMANCE_DIAGNOSTICS` is suppressed in production.

## Auth0 and Supabase identity

1. Keep the Auth0 application type **Single Page Application**, RS256 ID-token signing, Authorization Code/Refresh Token grants and rotating refresh tokens. The SDK uses PKCE. No custom API audience is requested; remove obsolete `AUTH0_AUDIENCE` / `VITE_AUTH0_AUDIENCE` settings. Review a tenant-wide Default Audience before changing a shared tenant.
2. Register each exact application origin in Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins and Allowed Origins (CORS). The callback is `location.origin`, not `/api/auth/callback`. Configure `APP_ORIGIN` to match. Register stable Preview origins explicitly.
3. Enable the existing email/password connection for this application, signups and password-reset delivery. Keep Google disabled.
4. Enable the existing **`paypal-sandbox`** social connection for this SPA. Its PayPal app uses Sandbox credentials/endpoints and Log in with PayPal return URL `https://YOUR_AUTH0_DOMAIN/login/callback`. Use a Sandbox Personal account. These credentials are separate from Add Funds Checkout.
5. Deploy [the Post Login Action](../auth0-actions/add-supabase-authenticated-role.js) and attach it to the Login flow. It sets the literal ID-token claim `role: authenticated`. Sign in freshly after changing the Action.
6. In Supabase Authentication > Third-party Auth, configure Auth0 using your tenant and region. Keep `private` out of exposed Data API schemas. Apply the complete migration sequence, preserve RLS and explicit grants, and never grant browser balance writes.
7. Test two separate authorized accounts in an isolated environment: onboarding/reload/logout, owned read-only rows, cross-account denial, renewal, reset delivery and PayPal callback. Inspect claims locally without sharing tokens. Equal email addresses do not link provider identities.

Browser Supabase reads use the Auth0 ID token through the SDK callback; no second Supabase sign-in/session is created. The existing Express verifier validates that same app-bound token before server operations. Missing/disabled database access returns unavailable private data, with no local wallet fallback.

## PayPal Sandbox Checkout

In PayPal Developer, choose the REST app belonging to the receiving **Sandbox Business** account. Set its Client ID/Secret and the same account's merchant ID. The merchant ID is neither the payer ID nor the Auth0 subject. Configure `APP_ORIGIN`; approved/canceled returns are generated from it. API and SDK hosts stay fixed to Sandbox.

Home and My Wallet share Add Funds. The SDK v6 loads on demand, checks eligibility and opens payer approval. Only a canonical completed capture matching merchant, ownership, identifiers, currency and exact amount can credit the ledger. URL return parameters and browser callbacks alone cannot add funds. Funding causes no round-up or report spending.

Minimum funding is 100 minor units (1.00 USD/ILS); the default maximum is `FUNDING_MAX_MINOR=500000` (5000.00), within the hard maximum of 10000000 minor units. `RATE_LIMIT_FUNDING` defaults to 10 per account per minute. USD is the conservative default. A successful ILS create/eligibility probe does not establish receiving acceptance at capture. JOD uses the existing explicitly reviewed internal conversion flow.

### Interrupted funding and refunds

- For uncertain approval/capture or database persistence, use the original funding attempt's **Check status** reconciliation. Do not create replacement money or a second order to hide uncertainty.
- If creation lost its response before an order ID was saved, retry the **same request key promptly**. Creation retries stop after five minutes; an older unbound attempt requires operator/provider inspection with its funding ID.
- Pending, failed and canceled attempts do not credit balances. A capture already completed must be reconciled even if a cancel callback arrives.
- A provider-verified full refund reverses once. Partial refunds or insufficient available funds enter `REFUND_REVIEW` and block protected financial mutations pending controlled operator resolution. Do not patch balances manually or make a wallet negative.
- There is no provider-refund initiation, webhook handler or unattended refund worker. Status reconciliation is user initiated.

Before advertising a funding currency, verify create/approve/capture, cancellation, repeated/concurrent reconciliation, persisted single credit, unchanged savings, wrong-owner denial and full-refund/review behavior using distinct authorized Sandbox payer/merchant accounts in isolated Preview.

## Gemini and market observations

Gemini reports use server-side structured Interactions output with `store: false`, schema/content validation and calculated totals kept separate. Coach/currency explanations use the existing generateContent adapter. Invalid credentials, quota, unsupported model, malformed output and timeouts keep deterministic fallbacks. AI cannot execute money operations or change rules without explicit reviewed acceptance. `npx tsx scripts/check-gemini-reports.ts --live` is an opt-in, potentially billable fixture-aggregate probe; it is not an authenticated account test.

PMA is the default indicative source. To select Twelve Data, configure the server key, licensed USD/ILS and USD/JOD legs (or supported inverses), and the `FOREX_*` / `TWELVE_DATA_*` settings in the example. Default five-minute polling can use 576 quote credits per day for two symbols; one-minute polling can use 2880 before other usage. Match budgets and display/storage rights to your actual entitlement. API success alone proves neither licensing nor independent price accuracy.

Twelve mode does not silently fall back to PMA. Missing/stale observations prevent financial quote confirmation; history contains recorded observations only. Serverless refresh is driven by shared due checks and daily Vercel cron, not a guaranteed continuous stream. [The optional Supabase cron recipe](../supabase/forex-cron.sql) requires separately reviewed Cron/pg_net/Vault configuration and quota planning; it is not an automatic migration.
