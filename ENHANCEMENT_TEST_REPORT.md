# Enhancement test report

Date: 2026-11-06. All financial mutations described below used local fixtures, PGlite or a disposable PostgreSQL cluster. No hosted migration, production financial mutation, push or deployment was performed.

## Executed results

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm test -- --reporter=dot` | **409 passed, 56 files** | Existing and new unit, component, API and PGlite database coverage. |
| `npm run test:e2e` | **41 passed** | Full local Chromium suite, including five new coach/guide cases and existing financial journeys. |
| Circle browser follow-up | **2 passed** | Real isolated SQL invite/contribution/two-account unanimous execution after the final timeline amount-display restriction. |
| Layout browser follow-up | **3 passed** | Revalidated grid refinement at desktop/tablet/mobile widths. |
| `npm run test:postgres` | **15 passed; 16 independent connections** | Real PostgreSQL 18.6 migration compatibility, shared storage, security, concurrency and exact Circle milestones. |
| `npm run build` | **Passed** | Both TypeScript configurations and Vite production build. |
| `npm run lint` | **Passed** | Static lint checks. |
| `npm run test:production` | **1 passed** | Final built assets, direct links and real exported local handler; no hosted provider operations. |
| `npm run check:node-function` | **Passed** | Plain Node ESM entry, config, private auth rejection, cron and origin protection. |
| `npm run check:secrets` | **Passed, zero suspected exposures** | Six Git revisions, 1006 historical files and 293 current/public files at scan time; environment files ignored. |

The last full browser suite passed before the final display-only timeline restriction and grid refinement. Its affected Circle and layout suites were rerun afterward. Unit coverage was rerun after the timeline restriction. This is not a claim that external providers were exercised.

## New risk coverage

Forecast tests cover exact minor units, USD/ILS/JOD precision, rounded-up completion days, partial observation days, insufficient age/contributions/distinct dates, nonpositive net pace, reversals, assignment exclusion, completed/overfunded/archived goals, future/old samples, hypothetical isolation, invalid amounts and the date horizon. Spending tests exclude round-ups/funding from merchant spending. Low available funds suppress increased round-up suggestions.

Coach service tests verify anonymized inputs, account-isolated cache scopes, permitted output, numerical/invalid output fallback, provider/quota failure and invalid database snapshots. Existing provider tests exercise strict JSON/schema parsing, timeout/error behavior, rate limits and cache invalidation. The coach never uses model-generated arithmetic or financial instructions.

Database tests exercise membership privacy, timeline ordering/cursor boundaries, all crossed milestone thresholds, deduplication after return/recontribution, owned coherent coach totals, direct-client permission denial, stale destination/rule/ledger rejection and negative refund-only monthly spending. A separate migration test builds the complete old schema, creates/contributes/returns real test funds, applies the new migration and verifies unchanged wallets, silent baseline bookkeeping and no invented activity/notifications. Previously reached Circles with retained completion markers are baselined at all thresholds even when their current balance has fallen.

The PostgreSQL concurrency test sends eight contributions through independent sessions. It asserts the exact shared balance (800 minor units), exact remaining wallet balance (9200), and exactly four uniquely recorded milestones. Existing tests retain atomic wallet/circle reconciliation, idempotency, forged-vote rejection, invitation privacy, rejection/expiration and unanimous execution/replay coverage.

Browser tests cover deterministic versus hypothetical display, immediate scenario update without financial writes, invalid input, insufficient history, API failure/retry without hiding the wallet, unavailable AI, completed long names, optional guide skip/refresh/resume, confirmation/cancellation, modal focus and real isolated SQL multi-account Circle flows. Provider SDK callbacks remain controlled fixtures.

## Failures found and resolved during implementation

- A SQL alias syntax error initially prevented migration suites from loading; fixed and migration suites passed.
- New API routes exposed older generic mocks returning unrelated state objects. Response guards and fixture adapters were corrected so auxiliary sections cannot crash the wallet.
- Guide persistence invalidated in-flight Circle reads. Restricted nonfinancial request invalidation was fixed and a client regression now keeps the pending read alive.
- An extra parenthesis in the test-only financial browser harness caused nine mount failures in one full run. The harness was rewritten as readable statements; subsequent full browser runs mounted correctly.
- One database expectation assumed gross spending (6100). The new signed projection correctly returns net 6000 after a 100 refund; its assertion and comment were updated.
- Existing layout copy tests prohibited the word Sandbox. Only that prohibition was removed to match the requested visible Sandbox guidance; the ban on implementation jargon remains.
- Confirmation dialogs required existing tests to perform explicit Confirm. Cancel and focus checks were added to the browser journey.
- Visual review found tiny SVG date labels, an incomplete desktop grid row and an event-metadata amount that should not be formatted as money. Each received a focused fix and affected checks.
- A new migration test needed an explicit query-result type; corrected before the final build.

No failed assertion was hidden with a retry or a longer timeout. Environment warnings about Node color flags and one existing React test-environment `act` warning do not represent verified production behavior.

## Visual evidence and scope

See [UI_UX_REVIEW.md](UI_UX_REVIEW.md) and `enhancement-evidence/` for preserved inspected screenshots. They use synthetic test accounts and amounts. Home, coach and Circle screens include 375/768/1024/1440 widths; dialogs, empty/error/validation and completed states are also represented. The browser suite checks intermediate sizes and short sidebar heights. No full WCAG, screen-reader, browser-zoom or cross-engine certification is claimed.

## External integration boundary

Live PayPal capture, Auth0 tenant callback behavior, hosted Supabase rollout and live Gemini responses were not newly tested. The existing live-test harness and earlier live deployment reports remain unchanged records of their own runs. Local success is not substituted for provider success. Before a hosted release, apply the new migration to an authorized isolated project and perform the demo guide with two authorized accounts and real Sandbox provider responses.

Final Vite output: App chunk 109.16 kB (32.60 kB gzip), main entry 272.18 kB (85.34 kB gzip), Auth0 chunk 246.33 kB (70.84 kB gzip), CSS 47.46 kB (11.19 kB gzip). No new package dependency was added. The final controlled startup benchmark retained one critical bootstrap request and three database reads, median 87 ms under its specified injected latency; it is not a hosted performance measurement.
