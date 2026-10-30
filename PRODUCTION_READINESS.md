# Dream Piggy Bank — production-readiness implementation

Reviewed: 29 October 2026. No deployment, remote configuration change, database rename, data reset, real payment or outgoing support message was performed.

## Audit and preserved architecture

React 19/TypeScript, Tailwind 4, Vite 7, Express 5, Auth0 and optional Supabase remain intact. Supabase stores profiles, wallet balances, transaction headers/postings and savings rules. Existing auxiliary goals, alerts, notices, reports, Sandbox records and rate observations remain in SQLite locally or the server-only Firestore collection in hosted environments. This split is important: Supabase alone is not currently the complete persistence configuration.

Auth0 email and PayPal Sandbox social sign-in use the existing SDK and ID-token verification. The browser's direct Supabase request reads its own profile to validate RLS; financial mutations go through the verified backend and service-only RPCs. Migrations enable RLS, read-only browser policies, opaque subject ownership and service-only transactional ledger procedures. Existing database tests exercise these rules in PGlite. Firestore rules deny browser reads/writes.

All wallet balances and operations are simulations. Live-authenticated accounts initialize at zero. Configured PayPal Sandbox checkout is a separate USD 1.00 test and does not fund balances. Gemini receives computed facts with names/merchants excluded; calculated fallbacks remain available. PMA history begins with real stored observations; local demo history is explicitly simulated. Goal editing, partial refunds, real transfers/withdrawals, email/push alerts and scheduled AI delivery remain absent.

## Implemented changes

- Dream Piggy Bank display branding, npm slug, titles, Open Graph description, accessible labels, report download prefix and documentation. Existing environment names, database/RPC identifiers, Auth0 registrations/connections, Firestore collection, domains and browser keys are preserved.
- Public About, Privacy, Terms, Acceptable Use, Cookie, Financial Disclaimer, Contact information, Help Center and storage-preferences routes. No account is required. Unknown pathnames show a branded 404. Existing hash navigation is retained; malformed wallet fragments still fall back safely.
- Searchable categorized help, factual instructions, FAQs and links to supported workflows. No support endpoint/contact is invented.
- Reusable skeleton/card/table/chart/goal/profile/report shapes, reduced-motion styling, initial page placeholders and first-report loading. Already-loaded data remains visible during focus refresh or report regeneration. Notifications are part of loaded wallet state and have no artificial extra loading request.
- Typed API status errors, 429 cooldown UI, safe-return whitelist, branded 401/403/404/429/500/503 states, render boundary, sanitized backend/Auth0 failures and request references. API responses, including authentication errors, use private/no-store headers.
- Lazy wallet and public-page modules; legacy Firebase browser imports are deferred to configured legacy flows. Provider bundles are separated for browser caching. No image assets or new runtime libraries are added.

## Caches and limits

Frontend reads use a small in-memory request cache. Concurrent identical GETs share a pending request. State freshness defaults to 1,500 ms and is capped at 10,000 ms by `VITE_STATE_STALE_MS`; other private GETs deduplicate only while pending. Account/provider transitions create a new cache generation and abort obsolete reads. Writes invalidate before and after completion, are never cached or automatically retried, and keep existing idempotency identifiers. Focus triggers controlled revalidation. No financial request cache is written to localStorage. Public configuration is cached separately for 60 seconds.

The existing transactional store backs production rate limits, AI reuse and concurrency leases. Vercel already refuses SQLite and requires Firestore, so these controls are shared across instances. Local SQLite transactions provide the development equivalent. Counter records are sharded by hash; expired identities are pruned when accessed and each shard has a defensive capacity bound. No raw IP, token, email or financial payload is stored in the new counter keys. This is suitable for demonstration/further development, not an untested high-volume quota service: load-test Firestore contention, costs and retention before public launch.

Limits use a 60-second window. Entry defaults to 120 per trusted source IP. After verification, read 120, AI 5, refresh 3, payment 5, profile/preferences/recommendations 20 and other financial mutations 30 use the server-verified account. Vercel headers are accepted only when running on Vercel; local/self-hosted mode uses the socket address and ignores arbitrary proxy headers. Configure a trusted ingress explicitly before introducing another proxy. Auth0-hosted authentication/reset endpoints remain under Auth0 controls. Unavailable limit storage fails closed with 503. Rejections return JSON 429 and Retry-After. Tests raise only the entry/read budgets in isolated test environments.

Gemini additionally has a shared 30-per-minute provider budget and three concurrent 30-second leases by default. Identical local in-flight generations deduplicate; the shared lease prevents another instance from duplicating the same cache scope concurrently. Another instance may receive a short 429 instead of waiting for the first result. Only successful explanation arrays are reusable. Fingerprints include anonymized computed facts, account scope, report frequency, financial input revision, model and prompt version. Current financial calculations/recommendations are rebuilt; only unchanged explanations are reused and their generation time is labeled. Default TTL is 15 minutes. Key changes invalidate reuse; expiry is not physical deletion. Each scope retains its latest entry until overwritten/housekeeping.

PMA defaults to six-hour cache TTL and a 36-hour stale threshold. The effective stale threshold cannot be shorter than the refresh TTL and is returned with authenticated wallet state for consistent UI labels. Shared leases and local pending promises suppress concurrent refreshes. Source, last retrieval and prior stored history remain visible after failures. No substitute rates are produced. Publication times are unknown. The default local interval follows the TTL; Vercel's existing daily cron schedule remains unchanged.

All knobs are listed with safe values in `.env.example`. No extra third-party service or migration is needed for these controls.

## Storage and legal decisions

The existing Auth0 SDK uses localStorage for its session/token cache and necessary provider cookies. Its configuration was preserved. Demo data uses the existing namespaced sessionStorage key, is local-only, and is removed on Exit Demo Mode. Production builds exclude the demo UI/service. Browser session restoration can retain tab storage; exiting is the explicit cleanup action. The server clears but does not issue or trust the legacy `ww_session` cookie.

No application-installed analytics, advertising or marketing scripts were found. Therefore no optional consent banner, fake tracking categories or consent-persistence record was introduced. Settings and `/storage-preferences` explain necessary storage, provider sign-out, demo exit and browser controls. Tenant/hosting-level script configuration still requires an owner audit; adding optional technologies requires a fresh consent review before activation.

Before a public production launch the owner must supply/review: legal operator/controller identity, actual support/privacy contact, applicable jurisdiction and rights, eligibility rules, retention/deletion procedures (including auxiliary data, caches, diagnostics and backups), provider terms/data regions, tenant cookies/scripts, and production contract wording. No self-service account-deletion mechanism or universal automated retention policy exists. No compliance certification, banking license, guaranteed encryption implementation or regional residency is claimed. The notices explain the implementation; they are not a substitute for owner/legal review.

## Deployment

Keep existing Auth0 client IDs, database connection and `paypal-sandbox` connection. Review callback/logout origins, refresh-token settings and Supabase's Auth0 integration/role claim according to AUTH0_SETUP.md and supabase/README.md. Keep Supabase service secrets, Firebase credentials, Gemini and PayPal secrets server-side. No `VITE_` secret is needed. `.env.example` uses public placeholders, not the local tenant/client values.

Vercel needs Node 24, `STORAGE=firestore`, server Firebase credentials, APP_ORIGIN, existing Auth0/Supabase configuration and CRON_SECRET; deploy Firestore rules separately. Security headers now cover static pages as well as API responses. `vercel.json` CSP permits standard Auth0/Supabase/Firebase origins; explicitly add a verified custom Auth0 domain or nonstandard self-hosted Supabase origin before using it. Do not loosen the policy broadly to work around configuration errors. Local production Express also applies Helmet.

Test browser ports use 5187 (API 3101) to avoid an already-running development instance on 5174. No user development process was stopped. Static SPA routes (including branded 404) return the hosting shell status; only API errors provide actual HTTP error codes. SSR/prerendering for per-route crawler status/metadata is not implemented.

## File inventory

New: `src/requestCache.ts`, `src/errors.ts`, `src/ErrorState.tsx`, `src/Skeleton.tsx`, `src/InfoNavigation.tsx`, `src/PublicPages.tsx`, `src/infoContent.ts`, `src/helpContent.ts`, `server/reliability.ts`, `tests/request-cache.test.ts`, `tests/client-api.test.ts`, `tests/reliability.test.ts`, `tests/rate-limit-api.test.ts`, `tests/public-pages.test.tsx`, `tests/cached-ai.test.ts`, `tests/e2e/public.spec.ts`, and this report.

Updated: `src/App.tsx`, `src/Auth.tsx`, `src/Onboarding.tsx`, `src/api.ts`, `src/demoSession.ts`, `src/Rates.tsx`, `src/Settings.tsx`, `src/main.tsx`, `src/styles.css`, `src/Dashboard.tsx`, `server/app.ts`, `server/ai.ts`, `server/reports.ts`, `server/currency-insights.ts`, `server/rates.ts`, `server/index.ts`, `shared/types.ts`, `shared/currency-insights.ts`, `index.html`, package/lock manifests, Vite/Vitest/Playwright/Vercel configuration, `.env.example`, README and existing display-brand documentation/test/script expectations. Other source files may have formatting-only updates. No existing data files or credentials were edited.

## Verification status

Verification results are recorded after the final check run below. Live Auth0 tenant, Supabase cloud, Firestore multi-instance, Gemini, PayPal Sandbox and hosted cron behavior require external configuration/credentials and have not been claimed as live-tested. Existing mocked/fixture tests exercise authentication, database permissions, financial consistency and service failures. A real payment is never made by the tests. Lighthouse was not run; browser screenshots/layout checks, production build size and the production demo-gate check are used instead.


### Final executed results

- TypeScript: `npm run typecheck` passed; `npm run build` also includes `tsc --noEmit`.
- ESLint: `npm run lint` passed.
- Unit/component/API/database tests: `npm test` ? **140 passed in 23 files**. Includes real local API 429 responses, durable counter concurrency, account/cache isolation, mutation invalidation, TTL, cancellation, Gemini output reuse/invalidation/failure handling, skeletons, help, storage information and error states. Existing RLS/financial tests also passed.
- Browser tests: `npm run test:e2e` ? **19 passed**. Covers existing authentication/financial journeys, desktop/tablet/mobile layout, carousel mouse/touch/reduced motion, public information/help/storage pages, 404, delayed skeletons and 429 recovery.
- Production build passed. Largest JavaScript chunk is approximately **248 kB** (entry approximately 78 kB gzip); separate Auth0, Supabase, legacy Firebase, wallet and public-page chunks replace the former single large application bundle. No Vite >500 kB chunk warning remains. This is a bundle measurement, not a Lighthouse score or a network-latency claim.
- `npm run check:demo-build` passed: disabled local mode and production both protect login, reject forged demo storage, and omit the demo button; production assets omit the demo service and sample seed. The static check excludes public help prose when searching for the button label; browser assertions still verify actual absence.
- `npm audit --omit=dev --json` reported **zero known production dependency vulnerabilities** at the time of execution.
- Screenshots of the desktop dashboard and mobile help/savings views were inspected. Layout tests check horizontal overflow at 1440, 820 and 390 px for existing wallet pages.

Implemented and locally tested: application rebrand, public routes/help/storage information, caches, durable local counters/leases, loading/error UI, split bundles and production demo exclusion. Implemented but not live-tested: Firestore multi-instance controls, credentialed Auth0/Supabase/Gemini/PayPal integrations and Vercel headers/cron. Blocked by owner/external configuration: production identity/provider setup and legal/support/retention decisions. Not implemented: real-money services, goal editing, full-history API/UI pagination, self-service deletion, automatic universal retention cleanup, SSR error status/prerendering, optional tracking (not present) and Lighthouse profiling.

Implementation references: [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase function security](https://supabase.com/docs/guides/database/functions). Existing provider identifiers and authorization conventions were preserved rather than migrated.
