# Live deployment test report

Execution date: **2026-11-06**. Target: **https://pay-pal-project.vercel.app**.

The public deployment and Express function are working for the tested anonymous flows. **Full production readiness is not established.** The previous token-probe failure is resolved as an expected infrastructure rejection after the user confirmed Vercel's DDoS Mitigation rule in the Firewall dashboard. Authenticated financial/provider integration testing remains blocked by the absence of an isolated Preview, test Supabase project and dedicated accounts.

## Results

| Command/check                                                   | Result                                    | What it proves                                                                         |
| --------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run test:live:smoke`                                       | **11 passed, 0 failed, 1 blocked**        | Actual hosted public UI, assets, config and application/infrastructure rejection       |
| `npm run test:live:e2e`                                         | **31 blocked, 0 executed**                | Suite collects and reports missing environment; no hosted financial integration proved |
| `npm test`                                                      | **369 passed across 52 files**            | Local unit/integration coverage, including 12 new safety/artifact regressions          |
| `npm run test:postgres`                                         | **14 passed; 16 independent connections** | Disposable PostgreSQL 18.6 migrations, RPCs, transactions and concurrency              |
| `npm run test:e2e`                                              | **36 passed on full rerun**               | Existing local browser fixtures/UI/SQL; providers remain mocked                        |
| `npm run test:production`                                       | **1 passed**                              | Local production assets and real exported handler                                      |
| `npm run build`                                                 | Passed                                    | Both TypeScript configurations and Vite production output                              |
| `npm run lint`                                                  | Passed                                    | Static lint checks                                                                     |
| `npm run check:node-function`                                   | Passed                                    | Emitted ESM backend runs under plain Node                                              |
| Official Vercel function bundle + outside-repository Node check | Passed                                    | Actual emitted function includes and resolves Express backend                          |

An earlier local browser run had **35 passed, 1 failed**: the currency explanation fixture had no mounted `main h1` within its existing five-second assertion window. Both tests in that file passed unchanged in isolation, and the complete suite then passed unchanged. No root cause was established; this remains a recorded intermittent local fixture/mount observation. No assertion was weakened and no retry was added.

The full coverage inventory and unimplemented/blocked edge cases are in [LIVE_DEPLOYMENT_TEST_MATRIX.md](LIVE_DEPLOYMENT_TEST_MATRIX.md). The 31 Preview cases comprise 21 core executable scenarios and 10 explicit controlled-provider/clock/fault prerequisites. They are not 31 verified live workflows. Some broader requested variants remain local-only or require additional live fixtures, as individually recorded in the matrix.

## Version and serverless verification

Local base commit: `c7cea508ee09748f6208b0c585016d13017e4db4`, plus the uncommitted testing changes listed below. The deployment does not expose a verified Git commit. The smoke report includes a hash of hosted asset paths; that fingerprint must not be represented as a verified deployed commit.

`/api/config` returned 200 JSON with configured public Auth0/Supabase settings and no-store caching. Signed-out private reads returned 401 JSON. No `FUNCTION_INVOCATION_FAILED` or `ERR_MODULE_NOT_FOUND` was observed in these responses.

The existing ESM fix was inspected rather than blindly changed: `api/index.ts` exports from `../server/app.js`; backend compilation uses NodeNext and the package uses ESM. The official local `@vercel/node` **30.0.0** builder emitted:

```js
export { app as default } from "../server/app.js";
```

The materialized function contained `server/app.js`, **732 traced files**, runtime **nodejs24.x**, and no traced `.env` or `data/` files. Its exported handler passed config, private authorization, cron authorization and origin checks under plain Node, including after copying the complete function outside the repository. This is actual builder-output validation; it is not a new deployment or a reconstruction of the hosted artifact. The project was not linked/pulled or deployed through the Vercel CLI.

## Findings and repairs

**Confirmed infrastructure rejection:** the user checked Vercel's Firewall dashboard and confirmed six denied `/api/state` requests under **DDoS Mitigation**, with the `node` user agent. This explains the previous **403 `text/plain`** response, Vercel correlation/server headers and absent application `x-request-id`. The live rerun accepts this as rejection before Express; it does not claim that the application authenticated or processed the rejected request.

The exception is restricted to production `GET /api/state` with either of the two fixed deliberately malformed/unsigned tokens, status 403, `server: Vercel`, a nonempty `x-vercel-id`, no application request ID, `text/plain`, and the expected static Forbidden body. The body is discarded. Other statuses, HTML, generic 403 responses, application-generated errors, other endpoints and Preview do not qualify. All other API calls retain JSON expectations. The token test attaches a safe per-probe application/firewall classification.

Local backend tests still require **401 JSON**, including a new actual-handler regression for malformed, unsigned and genuinely expired signed tokens. Twelve live-runner regressions include negative controls for the infrastructure exception. No Vercel firewall setting or application authentication code was changed. A real deployed signed expired Auth0 session remains separately blocked; an unsigned token does not prove that workflow.

**Repaired scanner false positive:** the first live asset test treated Auth0's literal `-----BEGIN PRIVATE KEY-----` parser string as private-key material. Inspection found the marker, no actual base64 key payload and no known local private values in the fetched assets. A failing regression reproduced the distinction, then the scanner was corrected to require key material after the marker while retaining known-secret and secret-key detection. The asset test passed afterward. This was a testing defect, not a confirmed leaked key or application defect.

**Artifact handling:** added allowlist-based trace sanitization, error/title redaction, removal of Playwright's automatic DOM/source failure contexts, safe request-status summaries, and blocked-count JSON reports. Credentials are entered before Preview tracing starts; screenshots of private failures mask the entire body. Raw trace archives are removed after sanitization. Sanitized traces intentionally omit DOM, bodies, headers, cookies, action arguments/results, source resources and screenshots, so their debugging detail is limited.

No confirmed application logic defect was repaired in this run. Existing APIs, authentication, financial implementation, Supabase migrations and `.env.local` were preserved.

## Isolation and request safety

Production smoke uses fresh signed-out browser contexts. The transport guard rejects all non-GET/HEAD methods, external origins, real bearer tokens and known side-effect GETs, including bootstrap, cron and live rate refresh. Nine private GET endpoints were checked without authentication; no private data was retrieved. Normal requests can update operational counters/logs; no production business-data mutation was intentionally invoked.

Preview preflight requires all dedicated `LIVE_*` configuration, an explicit account-authorization flag and two distinct existing accounts. It reads both deployments' actual public configs, compares database identities, requires the explicitly authorized separate Supabase project URL/reference, matches Auth0 client/domain, checks schema/RPC visibility with the test-only key, and verifies both real RS256 Auth0 identities before funding. A Preview target equal to production fails during test collection, even if other variables are missing. No application `.env` values are used as test credentials.

No Preview configuration was available. Consequently no hosted database preflight, login, onboarding, fixture funding, invite creation, purchase, refund, conversion, contribution, vote, withdrawal, report generation or payment was performed.

When explicitly enabled in a future isolated run, fixture funding uses the existing privileged transaction RPC with balanced available/external postings. It never directly patches financial tables. Request IDs derive from a unique safe run ID; replay tests reuse their original IDs. Cleanup uses supported APIs: revoke invitations, cancel pending proposals, unanimously return group contributions, archive empty Circles and archive goals. It never bypasses approvals or deletes ledger history. Fixture funds and remaining resources are documented in a private ignored recovery journal; runs are not silently reset. Repeated runs require isolated fixture balance review.

## Running the tests

```sh
npm run test:live:smoke
npm run test:live:e2e
npm run test:live:report
```

Use `npm run test:live:report -- production-smoke` or `-- preview-e2e` to select a report. HTML and `safe-results.json` live under `playwright-report-live/<mode>/`; screenshots and sanitized failure traces are under `test-results-live/<mode>/`. These artifacts are ignored by Git. An all-skipped Playwright run exits zero: CI must also require `safe-results.json.result === "passed"` and zero blocked tests for a full-E2E gate.

For future Preview testing, copy [LIVE_TEST_ENV.example](LIVE_TEST_ENV.example) to ignored `.env.live.local` and supply only dedicated test values. Create the separate project/deployment/accounts manually; apply the repository's documented migrations only to that test project. Set Preview `APP_ORIGIN` to its own HTTPS origin, configure Auth0 callback/logout/web origins for that origin, enable the app's existing authenticated-role Action and matching database connection, and use only PayPal Sandbox server credentials. Then explicitly set `LIVE_ACCOUNTS_AUTHORIZED=true`; financial fixtures additionally require `LIVE_ALLOW_TEST_FIXTURE_FUNDS=true`. Configuration of these prerequisites was not performed or verified here.

The current provider fault cases are visible blockers, not automatic failure-injection implementations. Real Sandbox approval may require manual completion of provider challenges. Password reset requires an authorized test mailbox; expiration tests require safe signed-session/time fixtures. Live Gemini faults and FX outages require separately controlled Preview provider configuration. Production credentials and provider protections must never be bypassed to satisfy these tests.

## Evidence and modified files

Public home/invitation screenshots cover 375, 768, 1024 and 1440px. The passing token case records safe HTTP statuses and rejection layers; it uses Node HTTP rather than a browser context, so it has no browser trace. Browser failures retain sanitized traces; no private response bodies are shared. `safe-results.json` records local commit, counts, per-case duration/status and the absence of a verified deployment commit. Private recovery journals, when future Preview tests run, stay under ignored `.temp/live-state/` and must not be shared.

Changed files:

- `package.json`, `package-lock.json`: live commands and `fflate` development dependency.
- `.gitignore`, `eslint.config.js`: generated-artifact exclusions and Playwright fixture lint configuration.
- `playwright.live.config.ts`: separate production/Preview projects, serial execution, safe reporting.
- `tests/live/safety.ts`, `environment.ts`: target/transport guards and real Preview preflight.
- `tests/live/fixtures.ts`, `artifacts.ts`, `reporter.ts`: guarded browsers, sanitized artifacts and result accounting.
- `tests/live/smoke.spec.ts`: actual anonymous deployment checks.
- `tests/live/preview-harness.ts`, `preview.spec.ts`: real-provider/core financial scenarios, explicit blockers, ledger checks and supported cleanup.
- `tests/live-safety.test.ts`: twelve transport, configuration, scanner and redaction regressions.
- `tests/auth0-server.test.ts`: added strict backend 401 JSON regression for malformed, unsigned and expired signed tokens; existing authentication expectations preserved.
- `scripts/open-live-report.mjs`, `LIVE_TEST_ENV.example`: report launcher and credential-free configuration template.
- This report and `LIVE_DEPLOYMENT_TEST_MATRIX.md`.

Actual provider verification: **Vercel public deployment/function only**. Auth0 login, hosted Supabase financial RPCs/RLS, real FX-provider refresh, PayPal Sandbox payment/authentication and Gemini generation were **not live-verified**. Public configuration identifies configured services but does not prove their private workflows.

The final shareable-artifact audit scanned 37 files and 43 payloads, including embedded HTML report archives, against four known local private values and found no matches. The 375px invalid-invitation screenshot was also visually inspected; the error remains integrated with sign-in and readable without horizontal clipping. These bounded checks do not establish the absence of every possible unknown secret or accessibility defect.

No deployment, push, commit, production migration, provider configuration change or financial mutation was performed. Remaining release gates are isolated environment setup, executing the blocked scenarios, and completing the matrix's provider/fault/UI gaps before claiming comprehensive production verification.
