# Full application testing and repair report

Audit completed November 4, 2026 (Asia/Hebron). Application: Dream Piggy Bank, current local working tree.

## Outcome

**382 distinct automated tests passed: 346 Vitest tests across 50 files and 36 Chromium browser tests. Final automated failures: 0; skipped automated cases: 0.** Eight application defect groups were repaired. Thirteen external scenario groups remain incomplete; they are listed individually in [FEATURE_TEST_MATRIX.md](FEATURE_TEST_MATRIX.md), not counted as passing tests.

TypeScript, ESLint, production build, authenticated-build checks and the startup benchmark also passed. The benchmark repeats one case already included in the 346; it is not counted twice. Targeted debugging runs and the initial baseline are likewise excluded from the distinct final total.

The connected environment has **two demonstration blockers**: missing invitation-membership functions and an invalid Gemini API key. Real PayPal payer approval/capture has not been verified. This is suitable for a controlled local demonstration using the tested fixtures/calculated reports; an unrestricted provider-backed Sandbox demonstration should wait for the prerequisites below. This report does not approve real-money use or production deployment.

## Initial condition and baseline

The repository already contained extensive uncommitted application, database and test work. Those changes were preserved. The application uses React/TypeScript/Vite, Express, Auth0, Supabase PostgreSQL, PayPal Sandbox Checkout, shared SQLite/Firestore caches and server-side Gemini adapters.

The baseline was run before this audit's source changes:

| Check | Actual baseline result |
| --- | --- |
| `npm test` | 328 passed, 48 files, 0 failed; 25.22 seconds |
| `npx playwright test --workers=2` | 35 passed, 0 failed; approximately 1.1 minutes |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run check:savings` | Failed readiness: two new invitation functions absent from connected schema |

Passing baseline tests did not cover the invitation placement, target-currency activity filtering, stale Circle responses, clipboard absence or same-value notification refresh identified below. No baseline failure was suppressed and no tests were disabled.

## Inspection scope

The review covered all seven private navigation pages, public/help/error pages, login/signup/reset, onboarding, invitation pages, dialogs, wallet/activity hooks, private request caching, provider SDK adapters, Express middleware/routes, financial/report calculations, all ten versioned migrations, the standalone setup script and existing implementation guides.

The feature-by-feature expected behavior, executed test evidence, status and gaps are recorded in [the coverage matrix](FEATURE_TEST_MATRIX.md). Source inventory included:

| Layer | Routes/operations inspected |
| --- | --- |
| Public and entry | `/api/config`, limited public `/api/circles/invite/:token`, authorized `/api/cron`, static/SPA/public routes |
| Account/private reads | `/api/onboarding`, `/api/bootstrap`, `/api/state`, `/api/dashboard`, `/api/activity`, `/api/account/reports`, `/api/logout` |
| Wallet/goals | Purchases, refunds, preferences, legacy savings-default compatibility route, goal creation and archiving |
| Savings/Circles | Options, destination replacement, quotes, historical assignment, Circle list/detail/create, invitation status/join/generation, contribution and action routes |
| Market | Live/history/refresh rates, conversion preview/confirmation, alert create/toggle, mark-notifications-read and currency insights |
| Reports | Generate/save/reuse reports, accept/dismiss recommendations, archive pagination and JSON download |
| Funding | Configuration/history, create order, capture, reconcile and cancel |
| Database | Owner/RLS restrictions, service-only financial functions, idempotency records, savings quotes, ledger postings, contribution shares, proposals and snapshot votes |

General goal editing, alert deletion, live-money service, automatic report scheduling, account linking, external cash-out and email/SMS/push delivery are absent capabilities, not controls removed to obtain passing tests.

## Defects found and repaired

| ID | Reproduction / root cause | Repair | Regression evidence |
| --- | --- | --- | --- |
| B01 Invitation outside authentication layout | Open a valid Circle link while signed out. `AuthGate` rendered the preview as a sibling preceding the entire login layout. | Pass invitation content into `AuthScreen` and render it inside the existing authentication card. | New browser case checks login/signup card containment and screenshots at 375/768/1024/1440px. |
| B02 Cross-currency savings activity disappears | Filter activity by a purchase's credited savings currency. Server SQL correctly finds matching postings, but `Activity` filtered again using only purchase currency/manual-conversion `to`. | Include currencies from recorded postings in the client filter. | `tests/audit-ui.test.tsx` retains an ILS purchase with a USD savings posting under USD filtering. |
| B03 Incorrect category options | The default filter used `Food & Drink`, while purchase creation records `Food & drink`; Education was missing until present in loaded records. | Match the accepted category spelling and include Education independently of the current page. | Activity component test checks the exact filter request value and absence of the incompatible duplicate. |
| B04 Late Circle data overwrites a different selection | Start a slow refresh, return to the list, select another Circle and then receive the old response. Requests lacked cancellation/obsolete-response checks. | Abort superseded/unmounted loads and commit list/detail only for the active request. | Deferred-response test keeps the second Circle visible after resolving the first Circle's stale response. |
| B05 Circle read failure cannot recover cleanly | An initial failure left no retry control; later successful refreshes retained the old error. | Add read-failure retry, clear stale load errors, and track loading/failure separately. | Component test rejects the initial read, retries successfully and verifies the error disappears. |
| B06 Copy Link can throw before its catch | With `navigator.clipboard` unavailable, accessing `.writeText` throws synchronously before the promise catch. | Await copying inside `try/catch`; show the existing manual-copy fallback and clear errors after success. | Real-SQL Circle browser journey tests missing clipboard, then a successful clipboard write/read of the generated link. |
| B07 Notification checkbox disagrees with saved state | Toggle the uncontrolled checkbox, then receive a fresh preferences object with the original saved value. `defaultChecked` does not replace a dirty checkbox's checked state. | Control the notification checkbox and synchronize it with authoritative preferences, consistent with Smart Savings. | New component test refreshes unchanged saved preferences and verifies checked state returns to the saved value. |
| B08 Misleading reporting/refund instructions | Settings/help described a rolling 30-day month and implied all purchase refunds reverse Circle savings. Actual code uses calendar months and retains shared contributions. | Correct period labels and destination-specific refund copy in Settings, Smart Savings and Help. Update the feature guide. | Settings option assertion, report boundary/SQL refund tests, user-copy checks and final browser regression pass. |

These are eight **defect groups**. Two environment prerequisites and the dependency advisory findings below are tracked separately, rather than being counted as application fixes.

## Files changed during this audit

Application code:

- `src/Auth.tsx`: invitation inside authentication card.
- `src/Circles.tsx`: abort obsolete reads, recover failed reads, clear stale errors, handle clipboard absence.
- `src/Wallet.tsx`: posting-aware currency filter and canonical category options.
- `src/Settings.tsx`: notification checkbox synchronization and corrected period/refund labels.
- `src/App.tsx`, `src/helpContent.ts`: corrected refund/report descriptions.

Tests added:

- `tests/audit-ui.test.tsx`: activity filtering, Circle read recovery and asynchronous navigation race.
- `tests/circles-api.test.ts`: actual Express Circle router backed by the migrated isolated SQL database; membership, ownership, repeated contribution, forged vote and unanimous execution checks.

Tests expanded:

- `tests/access.test.ts`: protected savings/Circle reads and financial writes reject unauthenticated requests.
- `tests/circles-database.test.ts`: six savings conversion/refund directions; financial invariants after every database scenario.
- `tests/finance.test.ts`: six explicit manual conversion directions/minor-unit results.
- `tests/ui-refinements.test.tsx`: notification refresh and accurate monthly label.
- `tests/e2e/auth.spec.ts`: integrated invitation layout across requested viewports.
- `tests/e2e/layout.spec.ts`: all seven pages at 375/768/1024/1440px.
- `tests/e2e/circles.spec.ts`: clipboard failure and actual generated-link copy verification.
- `tests/e2e/reports.spec.ts`: JSON download filename and financial contents.

Documentation: this report, `FEATURE_TEST_MATRIX.md`, corrections in `ACCOUNT_FEATURES.md`, and README links to the deliverables. No dependencies, environment credentials, financial history or production balances were changed. No new database migration was needed for these repairs.

Temporary read-only/probe scripts and logs are under `.temp/application-audit/`; they are diagnostic artifacts and are not imported by the application.

## Final execution results

| Command / check | Actual result |
| --- | --- |
| `npm test` | **346 passed**, 50 files, 0 failed; 23.35 seconds |
| `npx playwright test --workers=2` | **36 passed**, 0 failed; approximately 1.1 minutes |
| `npm run typecheck` | Passed after all application/test changes |
| `npm run lint` | Passed |
| `npm run build` | Passed; Vite production assets built |
| `npm run check:auth-build` | Passed; fixture access absent from production assets, forged/private entry denied |
| `npm run check:startup` | Passed; one benchmark case, already included in Vitest total |
| `npx tsx scripts/check-integrations.ts` | Passed Auth0 discovery/JWKS, backend table visibility, anonymous denial, forged-token denial and preference-schema checks |
| `npx tsx scripts/check-server-readonly.ts` | All four checks passed: safe public config, anonymous denial, forged denial and configured database CSP origin |
| `npm run check:forex` | Passed live symbol directory and both configured quote legs; two quote credits consumed |
| `npx tsx scripts/check-gemini-reports.ts --live` | Failed external configuration: HTTP 400; follow-up safe diagnostic identified `API_KEY_INVALID` |
| PayPal Sandbox create/retrieve probes | USD 1.00 and ILS 1.00 orders created/read; both `CREATED`, merchant matched, **neither approved nor captured** |
| `npm run check:savings` | Connected database readiness failed: invitation status/join functions missing |
| Connected read-only reconciliation | 3 wallets, 60 ledger entries, 2 Circles checked; **0** wallet discrepancies, unbalanced transactions, Circle-share discrepancies or savings reconciliation issues |
| Secret scan | 2 Git revisions / 144 historical file instances / 41 source+public assets scanned; no suspected exposure; environment files ignored |
| Dependency audit | 16 moderate findings; 0 low/high/critical; see residual risk below |

Count convention: 382 is the distinct final automated suite total. Provider probes, static checks and environmental readiness checks are reported separately. A diagnostic failure is not relabeled an automated test pass. No claim is made that every possible interaction or external service has been certified.

## End-to-end workflows actually verified

1. Auth0 entry, registration routing, reset feedback and mocked callback restore, account persistence and logout. Provider responses are controlled.
2. Onboarding validation and dashboard transition with an isolated profile.
3. Add Funds for USD/ILS through controlled SDK approval/capture, including cancellations, merchant rejection, pending states and selected-currency isolation.
4. Personal goal creation, activation, simulated purchase, automatic savings, report, recommendation decision, refund and persisted settings.
5. Repeated personal/Circle destination switching and reload/new browser context, without moving previously saved funds.
6. Direct invitation in another browser context, explicit join, existing-member notice, two contributors, locked funds, exact voting and executed transfer using the actual local SQL functions.
7. Cross-currency ILS/JOD purchase savings into a USD goal, explicit skip when no destination exists, completion and refund isolation.
8. Report date selection, unavailable-AI fallback, saved archive and downloaded JSON matching the report's financial values.
9. Delayed/stale market data, bounded network errors, recoverable sections, no substituted zero balances and responsive navigation.

The multi-user SQL browser/API tests use explicit test identities. Production authentication enforcement is separately tested against the full application. The API harness does not establish that a real hosted Auth0 tenant accepted test credentials.

## Screenshots and visual review

The final browser run saved screenshots under `test-results/`. Visual inspection confirmed that the 375px invitation has no clipped controls or horizontal overflow, the desktop invitation remains inside the authentication column, and the mobile report preserves separate currency totals and visible AI fallback.

- [Mobile invitation](test-results/invitation-auth-375.png)
- [Tablet invitation](test-results/invitation-auth-768.png)
- [Desktop invitation](test-results/invitation-auth-1440.png)
- [Mobile reports/fallback](test-results/gemini-reports-mobile.png)

Other screenshot evidence includes Home, Smart Savings, Settings, funding and Circle screens from the browser suites. Automated viewport coverage is 375, 768, 1024 and 1440px for all seven pages, with additional legacy viewport cases. Keyboard carousel, reduced motion and labeled controls are covered. This is not a formal contrast/WCAG audit or screen-reader certification. Firefox/WebKit were not run.

## Financial integrity and security findings

The new invariant hook executes after each Circle SQL test, including failures, replay, refund, contribution, approval and return paths. It checks:

- Ledger postings sum to zero per transaction and currency.
- Available and savings wallet balances equal their respective owned ledger sums and never become negative.
- Circle balances equal both outstanding member shares and signed Circle ledger entries.

All invariant checks passed. Six new cross-currency purchase tests also verify the merchant amount stays in the purchase currency, only savings convert, and the original source/target balances restore exactly on refund. Duplicate API contributions return the same transaction, and repeat approved execution distributes funds once.

Authorization coverage rejects missing/forged identities, wrong-owner reads, non-owner proposals/invitations, forged/non-contributor votes and withdrawal before unanimity. Privileged functions remain unavailable to anonymous/browser database roles. Public invitation previews remain limited to goal metadata. Client-side restrictions are not the financial authorization boundary.

No balance corruption or unauthorized financial bypass was found in the executed cases. PGlite queues concurrent calls, so successful replay/locking assertions are not evidence of independent live PostgreSQL contention safety. The connected database reconciliation is a read-only observation, not a substitute for all live workflows or a cross-table consistent snapshot under concurrent writers.

The dependency audit's 16 moderate entries share the transitive `minimatch` advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Installed consumers include ESLint/TypeScript tooling and the Firestore dependency chain. The indicated fixed range crosses major/API boundaries for several consumers; forcing one new major version globally or accepting npm's suggested ESLint downgrade was not a safe repair. No runtime exploit was reproduced. A compatible upstream dependency upgrade and regression remains a tracked maintenance task; no finding is represented as fixed.

## Database prerequisite and exact application instructions

This audit made **no connected database writes and applied no migration**. Local SQL tests applied every migration in order in disposable PGlite databases; clean setup/bootstrap and preservation tests passed.

The read-only connected schema check found the earlier Circle functions/tables present, but these functions absent:

```text
/rpc/walletwise_invitation_status
/rpc/walletwise_join_circle
```

To enable the already-implemented membership-aware invitation flow:

1. In the intended Supabase project's SQL Editor, as the database owner, apply the entire existing [202611010001_circle_invitation_membership.sql](supabase/migrations/202611010001_circle_invitation_membership.sql).
2. Its dependency is the full prior migration chain, particularly `202610310001_savings_destinations.sql` and `202610310002_goal_savings_circles.sql`. Do not rerun the standalone `setup-wallet.sql` against an existing wallet database.
3. Run the whole migration in one transaction: `BEGIN;`, the complete file contents, then `COMMIT;`. On error, roll back and inspect the failure rather than executing fragments.
4. Run `npm run check:savings`; require `ready: true`. The migration also requests PostgREST schema reload.
5. Verify one new member join and one existing-member invitation using isolated test identities in the intended Sandbox environment.

The upgrade adds service-only read/join wrappers; it does not invent funds, erase records or rewrite balances. No additional migration is required by the eight repairs in this report.

## External limitations and remaining work

- **Gemini key:** the configured API key returned `API_KEY_INVALID`. Replace it with a valid server-side test key, then run `npx tsx scripts/check-gemini-reports.ts --live`. The configured model was not validated because key authentication failed; no claim is made that changing only the model resolves this.
- **Invitations:** apply the existing migration above. Before that, the connected membership-aware preview/join flow cannot be demonstrated successfully.
- **PayPal:** create/read and merchant binding succeeded, but a distinct Sandbox Personal payer must complete approval/capture for both currencies. Verify exactly one persisted credit, unchanged savings, recovery and merchant acceptance. The diagnostic orders remain unapproved and did not credit any wallet. No actual payer refund was tested.
- **Auth0/accounts:** real registration/password flows and mailbox delivery were not exercised. No production users or financial records were created for testing.
- **Concurrency/platforms:** independent PostgreSQL connections, serverless shared-cache deployment, Firefox/WebKit and assistive-technology testing remain unverified.
- **Dependencies:** resolve the moderate transitive advisories through a compatible dependency update; no high/critical advisories were reported by this audit.

All 13 incomplete external scenario groups are explicitly enumerated as E01–E13 in the matrix. Unsupported capabilities such as general goal editing or alert deletion were inventoried rather than silently implemented or marked passed.

## Demonstration and production assessment

**Local isolated demonstration:** the tested workflows can be demonstrated with clear provider-fixture boundaries and calculated report fallback.

**Connected provider-backed Sandbox demonstration:** conditional. Apply the invitation migration, replace/validate the Gemini key if AI is part of the demonstration, and complete the actual Sandbox payer smoke tests and hosted login checks. Until then, do not describe those flows as verified end to end.

**Production/real money:** not approved. This remains a simulated wallet with Sandbox funding, manual reconciliation boundaries, incomplete external validation and unverified independent database contention. No deployment was performed.
