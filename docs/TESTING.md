# Testing

## Local validation

Use Node 24.x and the committed lockfile. These commands use isolated fixtures/local databases; no hosted financial operation is required.

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run test:postgres
npm run test:e2e
npm run build
npm run test:production
npm run check:node-function
npm run check:auth-build
npm run check:secrets
```

Build before production-artifact/auth/secret checks. Tests opt out of application dotenv files and use controlled identities/providers. Keep existing assertions and fixture infrastructure. Playwright uses local ports 3101/5187; production smoke uses 5194. Avoid parallel runs of suites that own those ports or shared test outputs.

| Layer                                   | What it establishes                                                                                                                                                                          | Boundary                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Vitest (`npm test`)                     | Arithmetic, calendar/refund totals, components, cache/auth/authorization, API/provider verification, RLS and actual migration/RPC behavior through PGlite                                    | Provider transports are controlled; PGlite queues calls                      |
| Native PostgreSQL (`test:postgres`)     | Actual migrations and production storage adapter under disposable PostgreSQL, 16 independent connections, limits/CAS/leases/fencing, imports, Circle milestones and financial invariants     | Local binary/server, not hosted PostgREST or gateway configuration           |
| Local Chromium (`test:e2e`)             | Authentication routing/callback fixtures, onboarding, all seven views, savings/funding/reports, coach/guide, direct invitations, SQL-backed two-account Circle voting and responsive layouts | Auth0/PayPal/AI responses are fixtures; not completed provider login/payment |
| Production artifact (`test:production`) | Built static assets, direct links and the actual Express export under a local production server/CSP                                                                                          | Does not reproduce the Vercel CDN/runtime                                    |
| Plain Node ESM (`check:node-function`)  | Emitted backend imports, real handler config, private/cron/origin rejection                                                                                                                  | Independent of a materialized official Vercel bundle                         |
| Auth build / secrets                    | Test-only fixture exclusion, protected UI despite forged flags, bounded known-secret/signature scan of current/public/history content                                                        | Not proof that every unknown credential or remote revision is safe           |

Financial suites check balanced per-transaction/currency ledger entries, wallet-to-ledger equality, nonnegative balances, funding capture uniqueness, owned refunds/replay, quote rounding, Circle-share equality and contributor unanimity. No assertion should be weakened to make a cleanup pass.

`npm run check:startup` reruns the controlled benchmark already included in Vitest. It measures injected-latency data paths and one bootstrap/three database reads, not hosted Auth0/Supabase latency. Opt-in development `PERFORMANCE_DIAGNOSTICS=true` emits fixed-label `Server-Timing` and `dpb:` browser durations without records/tokens. PostgreSQL/PGlite tests and [SQL smoke tests](../supabase/README.md) do not replace two-user hosted gateway verification.

## Safe diagnostics

| Command                                           | Effect                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run check:deployment`                        | Configuration only, evaluated as cloud settings; local HTTP origin is expected to fail                             |
| `npm run check:database`, `npm run check:savings` | Read-only Data API schema visibility; missing objects fail, and do not prove actual function bodies/grants/history |
| `npx tsx scripts/check-integrations.ts`           | Read-only Auth0 discovery/JWKS and Supabase visibility/denial checks                                               |
| `npx tsx scripts/check-server-readonly.ts`        | Ephemeral handler public config, anonymous/forged denial and CSP                                                   |
| `npx tsx scripts/check-pma-readonly.ts`           | Read-only PMA provider response check                                                                              |
| `npm run check:forex`                             | Provider directory and, when configured, actual quote probes; consumes provider credits                            |
| `npx tsx scripts/check-gemini-reports.ts --live`  | Explicit potentially billable Gemini request using anonymous fixture aggregates                                    |

Do not treat `check:pma` / provider refresh helpers as read-only equivalents: inspect their storage/provider effects before running them. Legacy export/import modes and write safeguards are documented separately in [LEGACY_STORAGE.md](LEGACY_STORAGE.md).

## Hosted test runners

```sh
npm run test:live:smoke
npm run test:live:e2e
npm run test:live:report -- production-smoke
npm run test:live:report -- preview-e2e
```

Production smoke uses fresh signed-out contexts and permits only guarded GET/HEAD requests. It denies real bearer tokens, external origins, writes and side-effect GETs such as bootstrap, cron and live refresh. It can verify public UI/assets/config and rejection behavior. Normal requests can still affect operational counters/logs. It does not execute financial mutations.

The production token probe has a narrow Vercel-firewall exception for two deliberately invalid fixed tokens on `GET /api/state`. The historical Firewall dashboard confirmed DDoS Mitigation for that rejection. Recognizing an infrastructure 403 is not evidence that Express authenticated an expired session; local backend tests still require 401 JSON, and real signed-session expiration remains a separate hosted case.

For Preview, copy [LIVE_TEST_ENV.example](../LIVE_TEST_ENV.example) to ignored `.env.live.local`. Configure a separate deployment and Supabase test project, matching Auth0 client/domain and two distinct existing dedicated accounts. Application/production credentials are not inherited. Set `LIVE_ACCOUNTS_AUTHORIZED=true` only for those authorized test accounts; fixture funding additionally requires `LIVE_ALLOW_TEST_FIXTURE_FUNDS=true`.

Preflight compares actual production/Preview database identities, exact authorized test project and Auth0 settings, schema visibility and real RS256 identities before mutations. A Preview equal to production fails collection. Financial fixtures use existing balanced privileged transaction RPCs, never direct table patches. Runs use safe unique request IDs and supported cleanup; no approval bypass or ledger deletion is used. Private recovery journals stay in ignored `.temp/live-state/`. Preserve them after interruptions and review remaining resources/funds before another run.

Live report paths are `playwright-report-live/<mode>/safe-results.json` and HTML; screenshots/sanitized traces use `test-results-live/<mode>/`. Never publish raw artifacts/credentials. Error/title redaction and trace allowlists omit DOM, bodies, headers, cookies, action values, sources and screenshots; private failure screenshots mask the body. Sanitization intentionally limits debugging detail.

**An all-skipped Playwright run exits zero.** A full-E2E gate must require `safe-results.json.result === "passed"` and zero blocked cases. Ten provider/clock/fault prerequisite cases are explicitly skipped until their controlled fixtures exist, even when the basic Preview environment is configured. Counts alone cannot establish all requested workflows.

## Verification limits retained from previous audits

The November 6, 2026 recorded public deployment run verified anonymous hosted UI/assets/config/rejections; it did not establish the deployed Git commit or completed Auth0/PayPal/Gemini workflows. Its Preview suite executed no financial scenarios because the isolated environment/accounts were unavailable. That historical evidence must not be described as a fresh cleanup verification.

Earlier merchant-bound USD/ILS Sandbox order creation and SDK eligibility probes left orders unapproved. They did not establish capture, persistent credit, provider refund or ILS receiving acceptance. Earlier Gemini probes reported an invalid API key; no successful account-specific provider response was established. Current provider/account configuration must be checked separately rather than inferring that those historical blockers persist or were fixed.

Outstanding external coverage includes registration/reset mailbox, login/cancellation/renewal/real expiry, two-account hosted RLS, actual Sandbox approve/capture/cancel/recovery/refunds, real Gemini success/faults, provider licenses/FX outages and hosted shared limits/leases/cron. Broader currency pairs, stale quotes, invite expiry, proposal expiry/concurrency and fault recovery have local coverage but are not exhaustive deployed certification. Chromium/layout checks do not establish Firefox/WebKit, screen-reader, browser-zoom or full WCAG conformance.
