# Dream Piggy Bank: Vercel deployment

Prepared 2026-11-06. No deployment, provider dashboard change, database migration, wallet mutation, Git commit or push was performed during preparation.

## Read this before deploying

The repository is a **React 19 / TypeScript / Vite 7 SPA with Express 5**, not Next.js. Vercel serves `dist` and runs the existing Express app through `api/index.ts`. Supabase PostgreSQL is the only deployed database: wallet balances, transactions, goals, circles, funding orders, account state, provider history, private caches, rate limits and expiring fenced leases all use it. Firebase/Firestore is no longer a dependency. SQLite remains an explicit local/test adapter only; never use it or `/tmp` for deployed coordination. Apply the new backend-storage migration before selecting this adapter; see [SUPABASE_ONLY_MIGRATION.md](SUPABASE_ONLY_MIGRATION.md) for safe export/import and cutover.

**Current database prerequisites:** apply only missing migrations in filename order, including `202611010001_circle_invitation_membership.sql` and the new `202611060001_backend_storage.sql`. Run `npm run check:database` against the intended project after applying them. Earlier readiness checks found the two invitation functions missing; current hosted evidence is recorded in `SUPABASE_ONLY_VALIDATION.md`. No hosted migration or data import was performed.

The local environment remains a local configuration: `check:deployment` correctly rejects its HTTP localhost origin when evaluated as a Vercel configuration. Enter the deployment settings below in Vercel; do not upload local `.env` files. Previously documented provider results in `AUTH0_SETUP.md` are historical, not a fresh successful login test.

## Architecture and deployment settings

Backend ESM imports use explicit `.js` extensions, including imports written in TypeScript. Vercel emits individual JavaScript modules for the API; Vite only bundles the frontend. `npm run build` now checks both the frontend's Bundler configuration and `tsconfig.server.json` with NodeNext resolution. Run `npm run check:node-function` to compile and load the backend under plain Node without tsx or loader hooks. See [VERCEL_ESM_FIX.md](VERCEL_ESM_FIX.md) for the reproduced failure and official-builder verification.

| Setting | Exact value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root (`.`) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | `24.x` (also pinned in package.json) |
| Backend entry | `api/index.ts`, default export of `server/app.ts` |
| Function duration | 300 seconds; enable Fluid Compute and confirm the project supports this configured duration |
| Cron | `/api/cron`, daily at `08:00 UTC`, authenticated using `CRON_SECRET` |

`server/index.ts` is the standalone local server. Vercel does **not** start it, open a listening port, or run its `setInterval`. All existing `/api/...` paths and response formats use the same Express services. The function imports no second API implementation. PayPal recovery can involve several sequential provider requests; the 300-second function budget accommodates their existing 12/15-second deadlines and database work. Browser funding calls allow 180 seconds and report generation 60 seconds; ordinary reads retain 20 seconds and bootstrap 12 seconds. Financial mutations are never automatically retried. Gemini reports have a bounded 20-second default provider deadline, capped at 25 seconds. Supabase requests default to 8 seconds, capped at 15 seconds, with SDK retry behavior disabled.

`vercel.json` routes `/api/:path*` to the function before the SPA fallback, and explicitly excludes both API and asset namespaces from that fallback. Unknown API paths return JSON (401 when signed out, 404 after authentication). Existing app navigation is hash based: `/#Home`, `/#My%20Wallet`, `/#Smart%20Savings`, `/#Currency%20Rates`, `/#Reports`, `/#Savings%20Circles`, `/#Settings`. Public information/help pages, `/onboarding`, `/reset-password`, origin Auth0 callbacks, and `/circles/invite/<token>` load the SPA directly. Unknown page paths render the existing error page. HTML fallback is not a server-side page-404 status; that remains a static SPA limitation.

The daily authenticated cron performs bounded expired-infrastructure cleanup before refreshing rates. Cleanup is also sampled under rate-limit traffic; it never deletes financial rows or historical observations. All browser API requests are same-origin `/api`; no production API hostname or CORS wildcard is needed. API responses are `private, no-store`. Hashed assets get immutable one-year caching. Auth0 tokens stay in the existing SDK-managed browser cache; no new server session or cookie secret has been added.

Official configuration references checked during preparation: [Node functions](https://vercel.com/docs/functions/runtimes/node-js), [supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Express application exports](https://vercel.com/docs/frameworks/backend/express), [routing/configuration](https://vercel.com/docs/project-configuration/vercel-json), [function duration](https://vercel.com/docs/functions/configuring-functions/duration), [cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs), and [cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). The daily schedule fits the documented Hobby cadence; Hobby execution may occur within the scheduled hour and is not an exact-time guarantee.

## Environment checklist

In the tables, **P/Pv/D** means Production, Preview and local Development. Required services must be configured independently in every environment where you use the complete application. Use separate test projects/credentials for Preview; Preview deployments must not mutate a production ledger. All keys go into Vercel's environment settings, not Git. Mark private values sensitive where supported.

Only `VITE_STATE_STALE_MS` is embedded at frontend build time. Auth0 identifiers, Supabase publishable details and the PayPal Client ID are safe public values delivered by runtime endpoints. Every other variable is server/deployment configuration; never add a `VITE_` prefix to a secret.

| Variable | Purpose / where obtained | Required | Environments | Private? |
| --- | --- | --- | --- | --- |
| `APP_ORIGIN` | Exact application origin, e.g. `https://dream-piggy-bank.vercel.app`, no path; from Vercel Domains | Explicit value recommended; otherwise platform `VERCEL_URL` is used | P/Pv/D | No |
| `VERCEL_URL` | Vercel-provided current deployment hostname; fallback origin only | Platform managed | P/Pv | No |
| `VERCEL` | Platform marker; enforces cloud storage and Auth0/Supabase configuration | Platform managed; do not set locally | P/Pv | No |
| `NODE_ENV` | Production runtime selection | Platform managed | P/Pv; optional D | No |
| `AUTH0_ENABLED` | Set `true` | Yes | P/Pv/D | No |
| `AUTH0_DOMAIN` | Tenant hostname without protocol/path; Auth0 Application Settings | Yes | P/Pv/D | No |
| `AUTH0_CLIENT_ID` | SPA public client ID; Auth0 Application Settings | Yes | P/Pv/D | No |
| `AUTH0_DATABASE_CONNECTION` | Existing database connection; default `Username-Password-Authentication` | Default available | P/Pv/D | No |
| `SUPABASE_ENABLED` | Set `true` | Yes | P/Pv/D | No |
| `SUPABASE_URL` | Project HTTPS URL; Supabase Connect/API settings | Yes | P/Pv/D | No |
| `SUPABASE_PUBLISHABLE_KEY` | Project publishable key; Supabase API settings | Yes, or legacy alias | P/Pv/D | No |
| `SUPABASE_SECRET_KEY` | Project server secret; Supabase API settings | Yes, or legacy alias | P/Pv/D | **Yes** |
| `SUPABASE_ANON_KEY` | Legacy alternative to publishable key; do not set both unnecessarily | Alternative only | P/Pv/D | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy alternative to server secret | Alternative only | P/Pv/D | **Yes** |
| `STORAGE` | `supabase` on Vercel; unset also selects Supabase when enabled. `sqlite` is local/test only | Default available | P/Pv/D | No |
| `PAYPAL_CLIENT_ID` | Sandbox Business REST app Client ID; PayPal Developer > Apps & Credentials > Sandbox | Required for Add Funds | P/Pv/D | Public identifier |
| `PAYPAL_CLIENT_SECRET` | Secret for the same Sandbox REST app | Required for Add Funds | P/Pv/D | **Yes** |
| `PAYPAL_MERCHANT_ID` | Receiving Sandbox Business account's merchant ID; Sandbox account settings | Required for Add Funds | P/Pv/D | Server only |
| `PAYPAL_FUNDING_CURRENCIES` | Comma-separated verified merchant currencies; default `USD`; only USD/ILS supported by this app | Default available | P/Pv/D | No |
| `CRON_SECRET` | Generate a long random secret locally, at least 32 random bytes; Vercel sends Bearer authorization | Required for scheduled refresh | P; same rule for manual Pv/D calls | **Yes** |
| `GEMINI_API_KEY` | Google AI Studio API key with access to selected models | Optional; required for AI text | P/Pv/D | **Yes** |
| `GEMINI_MODEL` | Model supported by your account and the reports Interactions API; `.env.example` uses `gemini-3.5-flash-lite` | Default available; verify account access | P/Pv/D | No |
| `MARKET_DATA_PROVIDER` | `pma` default or optional licensed `twelve` | Default available | P/Pv/D | No |
| `TWELVE_DATA_API_KEY` | Twelve Data account key and appropriate pair/display/storage entitlements | Only for `twelve` | P/Pv/D | **Yes** |
| `VITE_STATE_STALE_MS` | Browser private-state freshness; default `1500`, capped at 10 seconds | Optional | P/Pv/D build time | No |

These optional operational variables have safe code defaults; keep them unless you have a measured reason to tune them. Their values are chosen by the app operator, not obtained from a provider. All belong in P/Pv/D unless marked local, and none contains a secret:

| Variables | Default / meaning |
| --- | --- |
| `SUPABASE_REQUEST_TIMEOUT_MS` | `8000`; database deadline, clamped 1000–15000 |
| `GEMINI_REPORT_TIMEOUT_MS` | `20000`; report AI deadline, max 25000 |
| `AI_CACHE_TTL_MS` | `900000`; account/facts-scoped AI reuse, never cached authoritative balances |
| `GEMINI_REQUESTS_PER_MINUTE`, `GEMINI_MAX_CONCURRENT` | `30`, `3`; shared provider quota and leases |
| `FUNDING_MAX_MINOR` | `500000`; per-order funding cap |
| `RATE_LIMIT_ENTRY`, `RATE_LIMIT_READ` | `120`, `120`; per-minute IP entry / authenticated reads |
| `RATE_LIMIT_AI`, `RATE_LIMIT_REFRESH`, `RATE_LIMIT_PAYMENT` | `5`, `3`, `5` |
| `RATE_LIMIT_PROFILE`, `RATE_LIMIT_FINANCIAL`, `RATE_LIMIT_FUNDING` | `20`, `30`, `10`; per-minute authenticated limits |
| `RATE_CACHE_TTL_MS`, `RATE_STALE_MS` | `21600000`, `129600000`; PMA cache / freshness |
| `FOREX_POLL_MS`, `FOREX_STALE_MS`, `FOREX_MAX_SKEW_MS` | `300000`, `180000`, `120000`; Twelve Data; effective stale threshold is at least twice polling interval |
| `TWELVE_DATA_MINUTE_CREDITS`, `TWELVE_DATA_DAILY_CREDITS` | `8`, `800`; provider budget limits |
| `FOREX_ILS_SYMBOL`, `FOREX_JOD_SYMBOL` | `USD/ILS`, `USD/JOD`; entitled provider legs |
| `PERFORMANCE_DIAGNOSTICS` | `false`; diagnostic timing is suppressed in production regardless |
| `PORT` | `3001`; **local standalone server only**, never configure Vercel port |
| `DATABASE_PATH` | `data/walletwise.db`; **local SQLite only** |
| `DISABLE_RATE_JOB` | `false`; **local server only**; tests set true; function starts no polling jobs |
| `WALLETWISE_LOAD_ENV` | `true` locally; false disables local dotenv convenience loading; Vercel always skips dotenv files |
| `WALLETWISE_API_TARGET` | `http://127.0.0.1:3001`; **Vite development proxy only** |

No `AUTH0_CLIENT_SECRET`, custom API audience, session secret, PayPal live/sandbox toggle, backend API URL, Firebase browser API key or Firebase login configuration is read or needed by this implementation. PayPal's provider and SDK URLs are hardcoded to Sandbox. Login's PayPal credentials belong in Auth0's existing social connection, not frontend environment variables.

## Supabase prerequisites and storage cutover

1. Confirm the intended Supabase project URL and both keys. Take a backup before any reviewed schema update. Never run `supabase db reset` against a hosted project, replay all migrations blindly, or replace `setup-wallet.sql` over an existing wallet installation.
2. Review migration history in the dashboard/CLI and apply **only missing migrations**, in this exact order:

   ```text
   202610260001_walletwise_core.sql
   202610260002_wallet_preferences.sql
   202610260003_accept_savings_rule.sql
   202610290001_forex_snapshots.sql
   202610300001_account_state_funding.sql
   202610300002_gemini_reports.sql
   202610300003_progressive_loading.sql
   202610310001_savings_destinations.sql
   202610310002_goal_savings_circles.sql
   202611010001_circle_invitation_membership.sql
   202611060001_backend_storage.sql
   ```

   The first migration changes default privileges in the public schema; inspect this especially on a shared project. `supabase/setup-wallet.sql` is a guarded bootstrap for a specific starting schema, not an incremental upgrade or a rerunnable migration. Use the individual migration files for existing installations.
3. Expose only the established public Data API schema; keep `private` unexposed. Preserve RLS, client SELECT-only grants, owner scoping, and service-only mutation RPCs. Reload PostgREST schema after updates (`NOTIFY pgrst, 'reload schema';` in SQL Editor).
4. Configure Supabase Authentication > Third-party Auth > Auth0 with the intended tenant and region. Deploy and attach `auth0-actions/add-supabase-authenticated-role.js` to Auth0's Post Login flow so fresh ID tokens contain literal `role: authenticated`.
5. Run `npm run check:database` with that project's server credentials in a private shell. It requests Data API schema metadata only; it performs no financial queries/writes or migrations. Verify migration history separately. `npm run check:savings` is the narrower existing schema check.
6. Keep the new internal tables in the unexposed `private` schema. The backend uses service-only public RPC wrappers with explicit grants and empty search paths. Counter increments use row locks and database time; expiring leases use ownership tokens and fencing. Cached wallet balances are never authoritative.
7. Set `STORAGE=supabase` (or remove STORAGE and keep SUPABASE_ENABLED=true). Remove FIREBASE_SERVICE_ACCOUNT and other Firebase deployment variables. Before cutover, export/import any required legacy history or auxiliary records using the read-only extractor and dry-run/reconciliation steps in SUPABASE_ONLY_MIGRATION.md. Pause old writers during cutover; do not switch traffic while both coordination stores are active. SQL wallet balances and history are not reset or copied.

No additional database or paid service is required. Shared infrastructure uses the existing Supabase project and consumes its normal request/storage capacity. Monitor SQL latency, active records and cleanup throughput; use separate Preview projects.

Firebase Admin, Firestore, their runtime dependency graph and the obsolete gRPC override have been removed. Run npm audit --omit=dev on the current lockfile; current results and any remaining advisories are recorded in SUPABASE_ONLY_VALIDATION.md. PostgreSQL test-server binaries are development-only and are not imported into the function.

## Auth0 dashboard: exact domain values

Let `O` be the exact origin, for example `https://dream-piggy-bank.vercel.app`. Replace this example with your own URL; do not enter literal `O`.

| Auth0 Application setting | Add |
| --- | --- |
| Application type | Single Page Application |
| Allowed Callback URLs | `https://dream-piggy-bank.vercel.app` |
| Allowed Logout URLs | `https://dream-piggy-bank.vercel.app` |
| Allowed Web Origins | `https://dream-piggy-bank.vercel.app` |
| Allowed Origins (CORS) | `https://dream-piggy-bank.vercel.app` |

The SDK uses `location.origin` as its callback, **not** `/api/auth/callback`. Register each stable Preview origin explicitly too. Do not wildcard arbitrary Preview domains. Set that deployment's `APP_ORIGIN` to the same origin; leave it absent to use Vercel's current deployment hostname only when that hostname is explicitly allowed in Auth0. A stable Preview/branch domain reduces repeated callback registration. Environment changes require redeployment.

Keep RS256 signing, Authorization Code with PKCE, Refresh Token grants, and rotating refresh tokens enabled. No custom API audience is requested; inspect any tenant-wide Default Audience before changing shared-tenant settings. Enable the configured email/password connection and the existing `paypal-sandbox` connection for this SPA. Verify password-reset email delivery. The official SDK handles state, nonce, PKCE, expiry and refresh. Its existing local-storage token cache allows refresh persistence but has the usual XSS tradeoff; keep CSP and dependencies maintained. No app-owned authentication cookies exist; Auth0's hosted cookies and SameSite/Secure policy are managed by Auth0. Verify silent renewal/rotation with browser privacy restrictions rather than assuming cross-site cookies always work.

The backend verifies RS256 signature/JWKS, issuer, client-ID audience, subject, expiry, issued-at claims, authorized party where required and authenticated role. It intentionally accepts the app-bound ID token used by the existing Supabase integration; this is not a generic OAuth resource server. Logout/account switching clears private request caches.

Circle invitations preserve their allowlisted path in Auth0 `appState`. After signing in, the visitor returns to the invitation and must explicitly join; viewing a link never grants membership. Invitation URLs use the validated application origin and cryptographically random tokens stored as hashes.

## PayPal Sandbox and Gemini

**Login:** in Auth0, enable `paypal-sandbox` for this SPA and set its Sandbox credentials and Sandbox endpoints. In that PayPal login app, set the Log in with PayPal return URL to `https://YOUR_AUTH0_DOMAIN/login/callback`, which is Auth0's callback, not the Vercel origin. Use Sandbox personal users. Auth0 login and Checkout can use distinct apps/credentials.

**Checkout:** create/select a Sandbox Business REST app in PayPal Developer. Configure its Client ID, Secret and receiving Sandbox merchant ID in Vercel. Begin with `PAYPAL_FUNDING_CURRENCIES=USD`; add ILS only after a real Sandbox test with the merchant confirms receiving support. JOD direct funding is intentionally unavailable. Payment approval/cancel return URLs are generated as `O/?funding=approved&fundingId=<id>` and `O/?funding=canceled&fundingId=<id>`. Follow any return-URL allowlist required by your PayPal application. Do not add live credentials or change the hardcoded Sandbox API/SDK URLs.

Order ownership, merchant, currency, amount, custom/invoice IDs, capture completion and provider responses are verified server-side. Durable request/capture IDs and SQL constraints prevent duplicate credits. Interrupted captures use read-back/reconciliation; retry the existing order rather than creating a new funding attempt. No webhook endpoint is implemented, so no webhook URL/signature configuration is required. Recovery is user initiated; there is no unattended webhook settlement/refund service. Full verified refunds can reverse through reconciliation; partial or problematic refunds require review. See `PAYPAL_FUNDING.md`. Simulated wallet purchases, conversions and savings remain clearly labelled and do not charge PayPal.

**Gemini:** add a private Google AI Studio key and select a model entitled to your account. Reports use the SDK Interactions API with structured JSON; currency explanations use `generateContent`. A configured model must support the APIs used by both paths. The example model is not proof of access in your account. Invalid/absent/rate-limited/timed-out AI yields existing fallback totals/errors; it cannot execute wallet writes. Prompts use calculated facts without raw credentials and are not logged. Gemini report requests set `store: false`; confirm your provider's data terms before sending financial aggregates. Run a real report and currency-insight request in Preview to verify model access and quota. Do not count the mocked unit tests as provider verification.

The static CSP now permits the actual Sandbox v6 SDK, Sandbox connections/frames/images and PayPal asset hosts, as well as standard Auth0 and Supabase hosts. If using a **custom Auth0 or Supabase domain**, add its exact HTTPS origin to the appropriate `connect-src`/`frame-src` entries in `vercel.json` before building. The Express CSP derives provider origins at runtime, but it does not serve Vercel's static HTML and cannot override its header. Test PayPal eligibility, popup/iframe flows and browser CSP reports in the deployed Preview. Do not disable CSP wholesale.

## Deploy manually

1. Review the working diff and this guide. Git's existing `origin` is `https://github.com/ArafatShweiki/PayPalProject.git`. No Git remote/branch setting was changed. Check `git status --short`; commit only reviewed source/config/docs. `.env*` files except `.env.example`, `data`, build output and `.vercel` are ignored.
2. Use Node 24, run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:postgres`, `npm run build`, `npm run test:e2e`, `npm run test:production`, `npm run check:auth-build`, and `npm run check:secrets`. Browser tests require Playwright Chromium (`npx playwright install chromium` if missing). Tests disable local credential loading and use isolated SQLite/PGlite/fixtures; they do not require live production credentials.
3. Review/apply missing database migrations and configure Supabase and provider dashboards as above. Do not change existing balances or historical transactions.
4. Commit and push the reviewed changes yourself. Import the repository in Vercel > Add New > Project, choosing Vite, root `.`, Node 24 and the commands in the settings table. Before the first import deployment, populate the required environment variables. Inspect `vercel.json` overrides rather than leaving conflicting dashboard commands.
5. Prefer an isolated Preview first. Configure Preview-specific Supabase/Auth0/Sandbox values and its exact origin/callback entries. For a new URL, assign a stable branch domain or obtain the deployment URL, register it, update `APP_ORIGIN`, and redeploy before user-flow testing. Do not connect Preview to a production ledger merely to simplify setup.
6. Run `npm run check:deployment` in a private shell using the **intended cloud settings** (or using a secure local env file). This checks configuration only; it does not contact providers or prove their credentials work. Do not paste secrets into shell history or screenshots.
7. Review Vercel's build/function logs; confirm `dist` and `api/index.ts` were produced and function runtime/duration accepted. If the Vercel CLI is installed and linked by you, run `vercel pull --environment=preview` and `vercel build` locally; downloaded `.vercel` files are ignored and sensitive. These commands were not run during preparation because no configured CLI/link was available. Do not run `vercel deploy` until you intend to deploy.
8. Complete the smoke checklist below against Preview, then deploy/promote to Production through Vercel after review. Configure Production origin and providers separately; do not promote a Preview built with the wrong public settings.
9. Optional custom domain: Vercel Project > Settings > Domains, add the hostname and apply the DNS records Vercel shows. Wait for HTTPS. Update `APP_ORIGIN`, all four Auth0 origin/callback entries and any PayPal return allowlist; redeploy. Use the canonical domain to create invitations. Keep old domains only while deliberately supported.

## Required deployed smoke checks

Use two distinct accounts and retain operation IDs/statuses, not credentials, as evidence:

- Open `/`, Help Center and another public page; refresh each. Navigate every hash route. Open an unknown route and a malformed invite. Confirm built JS/CSS return their correct content types. `/api/config` must be JSON with public identifiers only; `/api/state` signed out must be JSON 401 with no-store, never HTML.
- Register/sign in with email, finish onboarding, reload, close/reopen, renew an expired session, sign out and switch accounts. Verify password-reset delivery and canceled-login error handling. Repeat with PayPal Sandbox login. Confirm account separation and no stale user data after switching.
- With a Sandbox personal payer, add supported USD funds to the intended Sandbox merchant; confirm one matching ledger credit. Cancel approval, interrupt after approval/capture, reopen Add Funds and reconcile the existing order. Reconcile twice and verify no second credit. Test provider failures and unsupported currencies without switching to live PayPal.
- Create a personal savings goal; select it as default, simulate a purchase and confirm integer-minor-unit deductions and matching savings postings. Switch default to a Circle and back, including cross-currency quotes, expired quotes, an explicitly skipped round-up, refunds and historical assignment. New automatic savings must require an eligible personal goal or joined Circle; General Savings must not reappear as a new destination.
- Create a Circle, Copy Link and inspect the actual HTTPS domain. Open it signed out in a second browser, sign in, return to the same link and explicitly join. Confirm nonmembers cannot read private details/contribute/vote. Make manual/automatic cross-currency contributions and verify member shares.
- Request a withdrawal/return, attempt execution with missing approvals, then approve unanimously with both contributors and execute twice. Verify locks, exact balances and one execution. Test rejection, expiry, completion and archiving; no contributor's money moves without required approval.
- Generate reports and currency insights with live Gemini, then test missing key/quota/provider failure in the isolated environment. Calculated totals and ordinary wallet pages must stay usable. AI text cannot submit a financial mutation.
- Check Vercel Cron logs and authenticated manual invocation; an unauthenticated `/api/cron` must return 401. Confirm shared limits and lease recovery under concurrent function requests. Local real-PostgreSQL tests prove SQL contention behavior; hosted PostgREST/grants still need Preview verification.
- Inspect browser console/network for CSP, popup and third-party-cookie failures, and confirm no service keys/tokens in static assets, logs or API config. Compare two-user Supabase RLS in the actual hosted environment. Never share tokens to demonstrate this.

## Troubleshooting and rollback

| Symptom | Action |
| --- | --- |
| Build fails / unsupported Node | Select Node 24; run `npm ci` with the committed lockfile; run typecheck/build locally. Do not use `--force` to bypass dependency issues. |
| Function fails on import | Verify Auth0/Supabase enabled flags, HTTPS origin, `STORAGE=supabase`, the backend-storage migration and matching Supabase keys. Check logs without printing credentials. |
| Shared storage unavailable / lease expired | Apply the backend-storage migration and reload PostgREST schema. Verify service-only RPC grants, database availability and deadlines. Retry the original idempotent financial operation rather than bypassing protection. |
| API returns HTML | Confirm Vite preset, root directory and ordered API rewrite; inspect the requested `/api/...` URL, not only `/api/config`. |
| Direct invite is 404 / join unavailable | Confirm SPA rewrite and latest invitation migration; run `check:database`, reload schema, and verify the link is unexpired/unrevoked. |
| Origin returns 403 | Set `APP_ORIGIN` to the exact browser HTTPS origin; frontend supplies `x-walletwise: 1`. Do not weaken origin checks or enable wildcard CORS. |
| Auth0 callback mismatch / session lost | Register exact origin, enable SPA grants/rotation/connections, verify Post Login Action, sign in fresh and inspect cookie/privacy restrictions. No custom audience should be added. |
| Supabase PGRST202/PGRST205 / private API 503 | Check project, missing migration functions/tables, exposed schema and schema cache. Keep RLS enabled. |
| PayPal SDK blocked / unavailable funding | Inspect CSP, popup policy, merchant ID, Sandbox REST credentials and enabled currencies. Login connection credentials do not configure Checkout. |
| Payment times out | Reconcile the original persisted order; provider may have captured despite a lost response. Never add a wallet credit manually to hide a timeout. |
| AI unavailable | Check key/model/API entitlement, quota and deadline. Existing deterministic report totals remain usable. |
| Cron not invoked | Verify `CRON_SECRET`, Production deployment and schedule; Preview is not a production scheduler. Check plan cadence/limits and logs. |
| Function exceeds duration | Confirm Fluid Compute/duration; inspect provider latency and account count. Alert processing currently scans users; a large deployment needs a bounded continuation/job design before scaling. |

For an application regression, use Vercel Deployments to restore the last known-good deployment, then verify its matching environment/provider settings. Deployment rollback does **not** roll back database migrations or payments. Use reviewed forward fixes for schema changes; never reset the ledger, delete transactions or rewind balances. Retain backups and existing financial operation IDs. Rotate credentials if an actual exposure is discovered; the preparation scan found none of the checked signatures/known secrets in the scanned Git revisions and browser build.

## Validation status and remaining limits

Local checks and final counts are recorded in `VERCEL_VALIDATION.md`. The production smoke server imports the actual API export and serves real built artifacts with the static CSP; it uses a local socket and does not emulate Vercel's routing/CDN/runtime. The existing browser suite uses fixtures, including real embedded PostgreSQL for Circle workflows. Neither is a live Auth0/PayPal/Gemini integration test.

No Vercel Preview or Production deployment was made. Completed live login, rotating-session renewal, hosted two-user RLS, hosted backend-storage RPC access and multi-instance behavior, real Sandbox capture/refund/recovery, Gemini model access and deployed CSP/provider flows remain manual checks. The read-only schema inspection is the only new hosted database readiness evidence; it currently reports the seven new backend-storage RPCs missing; the previously missing invitation RPCs are now visible.

Daily cron plus user-requested rate refresh replaces the local polling loop on Vercel. It is not a continuous market feed or guaranteed five-minute background scheduler. Existing alert processing scans users and can exceed the function budget at large account counts; review a bounded processing design before that scale. Internal cached JSON is bounded to 4 MB per record; legacy account JSON still needs size monitoring. Expired caches, counters and idle lease scopes use bounded cleanup in cron and opportunistically under traffic; historical observations and financial data are never cleaned by this job. No paid scheduler, queue or new database architecture was introduced. Authentication keeps its established browser token-storage model. No webhook implementation was added. These limits must remain visible when assessing production scale and external readiness.
