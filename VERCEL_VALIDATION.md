# Vercel preparation validation

Date: 2026-11-06. Workspace: existing `PayPalProject` repository. No deployment, push, provider settings change, migration or live financial operation was performed.

## Result

The repository has deployment configuration and passes the local application checks. **Hosted readiness is conditional:** the configured Supabase Data API does not expose the final two invitation-membership functions; Vercel credentials/origins and external integrations still need the manual setup and Preview verification in [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Moderate dependency advisories remain. This report does not certify a successful Vercel deployment or live PayPal Sandbox payment.

## Verified locally

| Check | Result |
| --- | --- |
| Clean lockfile install (`npm ci`) | Passed; original dependency versions retained |
| TypeScript (`npm run typecheck`, also part of build) | Passed |
| ESLint (`npm run lint`) | Passed |
| Unit/integration suite (`npm test`) | 50 files, 350 tests passed |
| Existing browser suite (`npm run test:e2e`) | 36 Chromium tests passed |
| Production build (`npm run build`) | Passed, 1,658 modules transformed |
| Built-artifact/API smoke (`npm run test:production`) | 1 Chromium test passed |
| Production authentication/fixture audit (`npm run check:auth-build`) | Passed; six wallet sections protected at desktop/mobile sizes, forged storage flags rejected |
| Relative import existence/case audit | Passed for `src`, `server`, `shared`, `api` |
| Official Vercel JSON configuration schema | Passed against `https://openapi.vercel.sh/vercel.json` using the installed JSON Schema validator; schema dialect metadata normalized for that validator |
| Git diff whitespace check | Passed |
| Secret scan (`npm run check:secrets`) | No checked known private values/signatures found in three Git revisions, current nonignored source/config files or built browser assets; local env files ignored |

The initial full test run had one timing-sensitive UI wait failure in `progressive-loading.test.tsx` while other checks were competing for resources. Its isolated rerun and subsequent complete suite runs passed. A cold clean-install rerun also exceeded an API suite's existing 10-second setup deadline under unrestricted concurrent SDK/PostgreSQL imports. The runner now caps concurrent workers at four. No product behavior, assertions or timeout thresholds were weakened to hide those failures.

Concurrent browser suites also collided in Playwright's default artifact directory; the production suite now uses its own ignored output directory. A cold-run Gemini cancellation test exposed reliance on SDK cancellation propagation, so report generation now independently enforces the same provider deadline. A new regression test verifies timeout even when the underlying transport ignores cancellation.

The unit/integration suite includes actual embedded PostgreSQL migration execution, subject-based RLS/grants, wallet balancing/rollback, request/capture replay, duplicate funding/refunds, concurrent financial requests, cross-currency goal/Circle allocations, explicit membership, contributor shares, locked balances and unanimous approval enforcement. Auth0 server tests use locally signed JWTs. These checks prove local behavior and are not live provider evidence.

The built-artifact smoke test imports the **actual `api/index.ts` default export**, starts no development polling job, and serves the real `dist` artifacts with the static security policy. It verifies root/onboarding/reset/help/invitation/invalid-page direct loads, existing asset responses and missing-asset 404, signed-out JSON API responses/no-store headers, cron denial, origin/header rejection, and sign-in UI after reload. This uses a local Node listener and local SQLite coordination; it is not Vercel's function packager/CDN routing or hosted Firestore.

The current output is split into initial/authentication, Auth0, wallet-app and public-page chunks. Approximate gzip sizes: initial 84 kB, Auth0 71 kB, wallet app 28 kB, public pages 9 kB, CSS 10 kB. Existing lazy loading is preserved; no UI redesign or unrelated performance rewrite was added.

## Read-only hosted evidence

`npm run check:database` inspected the configured Supabase Data API schema without invoking RPCs or querying/modifying user financial records. It reported these missing paths:

```text
/rpc/walletwise_invitation_status
/rpc/walletwise_join_circle
```

They are defined in `supabase/migrations/202611010001_circle_invitation_membership.sql`. Review migration history and schema-cache visibility, apply only a missing migration after review, reload PostgREST, and rerun the check. Other migration-derived public table/function paths were visible. This does not verify exact hosted SQL definitions, RLS, grants, recorded migration versions or successful authenticated operations. No migration was applied.

`npm run check:deployment` was also run against the existing local environment as a cloud configuration. It correctly rejected the local HTTP origin. This is a configuration prerequisite, not a failing product test: supply the intended HTTPS Vercel origin and enabled Auth0/Supabase/Firestore settings. Positive and negative cloud configuration validation use safe fixtures in the unit suite.

## Security changes and findings

- The static Vercel CSP previously blocked the app's Sandbox v6 PayPal SDK. It now permits Sandbox SDK/assets, frames and connections while retaining self-only application scripts, no objects, restricted base/form/frame policies and the existing security headers. Custom provider domains need explicit additions documented in the guide.
- The SPA fallback explicitly excludes API and asset paths. The API keeps structured JSON errors, correlation IDs, private no-store responses and fail-closed authentication. Invalid mutation origins/protection headers now return 403 rather than masquerading as a sign-in failure.
- Application origins are centrally validated and normalized for requests, invitation generation and PayPal returns. Cloud deployments can use Vercel's trusted deployment hostname as fallback; localhost cannot silently become the cloud invitation/callback origin.
- Cloud runtime validates authenticated Supabase and durable Firestore configuration. Vercel never reads local dotenv files. `.vercel/` is ignored because linkage/downloaded build settings can contain secrets.
- Shared Firestore rate limits/leases, SQL ledger locks, idempotency fingerprints, funding merchant/capture verification, invitation hashes, membership checks and unanimous voting rules are preserved. No in-memory financial lock, privileged client key or alternate authentication mechanism was added.
- Browser request deadlines now accommodate sequential Sandbox funding recovery (180 seconds) and report generation (60 seconds); ordinary reads/bootstrap stay bounded at 20/12 seconds. Financial mutations still do not automatically retry.
- Report generation independently enforces the existing abort deadline even when the SDK transport stalls; the underlying request still receives the cancellation signal. This prevents provider cancellation delays from keeping a report request open indefinitely.
- Secret scanning now includes the Twelve Data key and current tracked/untracked nonignored files in addition to Git history and browser output. It is a known-value/signature scan, not proof against every possible secret format.
- `npm audit --omit=dev` reported **6 moderate, 0 high, 0 critical** production dependency findings. The complete audit reported **12 moderate, 0 high, 0 critical**. Findings propagate from filesystem glob/cancellation vulnerabilities through the Firebase/Google dependency graph, with additional TypeScript ESLint development dependencies. A compatible audit fix did not remediate them; unrelated patch churn was discarded. Forced major transitive overrides were avoided. This remains an outstanding security maintenance item; see the deployment guide.

## Files created

| File | Purpose |
| --- | --- |
| `VERCEL_DEPLOYMENT.md` | Exact deployment procedure, full env checklist, migrations, provider dashboard values, tests, troubleshooting, rollback and limits |
| `VERCEL_VALIDATION.md` | This report and evidence boundaries |
| `scripts/check-deployment.ts` | Non-network cloud configuration check without printing credentials |
| `scripts/check-database-readiness.ts` | Read-only schema readiness check derived from every migration |
| `scripts/preview-production.ts` | Local built-artifact server using the real function export |
| `playwright.production.config.ts` | Isolated production-artifact smoke configuration |
| `tests/production/deployment.spec.ts` | Built assets, direct links, API boundaries, security policy and refresh checks |

## Files modified

| File(s) | Change |
| --- | --- |
| `vercel.json` | Explicit Vite/npm-ci settings, API-excluding SPA rewrite, 300-second function duration, Sandbox CSP and immutable asset cache |
| `package.json` | Deployment/database/secret checks, production preview and test scripts; Node 24 retained |
| `.env.example`, `.gitignore`, `README.md` | Public/private/development guidance, actual variable names, ignored Vercel state and deployment entry link |
| `server/configuration.ts` | HTTPS origin and cloud prerequisite validation |
| `server/env.ts`, `server/app.ts` | No dotenv loading on Vercel, cloud validation and explicit 403 for origin/header violations |
| `server/funding.ts`, `server/savings-circles.ts` | Use the validated origin for payment returns/invitations |
| `server/gemini-reports.ts`, `tests/gemini-reports.test.ts` | Independently enforce and regression-test the AI provider deadline |
| `src/api.ts` | Bounded provider-workflow request deadlines |
| `scripts/audit-secrets.ts` | More complete current-tree/known-key coverage |
| `tests/configuration.test.ts`, `tests/client-api.test.ts` | Regression coverage for deployment prerequisites, unsafe origins and provider workflow deadlines |
| `vitest.config.ts`, `playwright.config.ts` | Bound concurrent test workers to four for reliable cold-install/CI execution |

The existing function export, financial SQL/migrations, database/provider choice, auth model, wallet calculations, UI and financial permissions are preserved. No new service was provisioned. Local install/test/build artifacts are ignored.

## Verified on Vercel Preview

**None.** No Vercel CLI was installed/linked for this task, and no Vercel build or deployment was performed. Published schema validation and local Express-export smoke tests do not replace a Preview deployment.

## Requires manual configuration / not yet tested live

Configure Vercel env values, Firestore database/IAM, Supabase migrations and Auth0 integration/Action. Register the exact app origin in Auth0 callback, logout, web origins and CORS settings; the app callback is the origin itself. Configure the separate `paypal-sandbox` social connection and Sandbox Checkout credentials/merchant. Add Gemini key/model access if desired. Review outstanding dependency advisories.

Then perform every deployed smoke check in `VERCEL_DEPLOYMENT.md`, particularly complete email/PayPal login, persistence/renewal/account switching, hosted two-user RLS, actual Sandbox capture/cancel/reconciliation/refund, live AI model/error handling, cross-browser invitation return/join, unanimous Circle execution and multi-instance Firestore coordination. These remain unverified. Custom-domain CSP, Vercel route/CDN behavior, function packaging/cold starts/duration and production cron execution also require the first deployment review.

The scheduled rate job is daily, supplemented by request-triggered refresh, not an always-running provider poll. Existing all-user alert evaluation and document-size limits need a bounded-processing design before large-scale use. No paid scheduler or unattended webhook recovery was added.
