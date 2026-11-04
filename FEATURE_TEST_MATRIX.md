# Feature inventory and test coverage

Audit date: November 4, 2026 (Asia/Hebron). Scope: the current working tree, including earlier uncommitted work. Source code, SQL and executed assertions take precedence over older implementation reports.

**Status key:** PASS = automated behavior executed successfully in the final regression; PARTIAL = some real-provider checks succeeded but the complete external workflow was not executed; BLOCKED = an identified environment prerequisite prevents verification; NOT IMPLEMENTED = no such application capability exists. A PASS using provider fixtures does not certify the external service.

## Authentication and onboarding

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| A01 Email entry and registration routing | Login/signup use the configured Auth0 database connection; email hints and signup mode are preserved; no custom API audience | Component: `tests/auth.test.tsx`; browser: `tests/e2e/auth.spec.ts` | PASS routing; actual provider registration and passwords remain external cases E01–E03 |
| A02 Password reset | POST the configured email connection, show neutral feedback and handle failure without revealing account existence | Auth component/browser tests | PASS request/feedback with controlled responses; real delivery E04 unverified |
| A03 PayPal sign-in | Route to `paypal-sandbox`, handle errors/cancellation, restore callback and return routes | Auth component/browser tests | PASS SDK routing and mocked callback; actual provider interaction E05–E06 unverified |
| A04 Protected pages and APIs | Missing/forged tokens and browser flags cannot reveal private balances or authorize financial writes | `tests/access.test.ts`, `tests/auth0-server.test.ts`, `tests/e2e/funding.spec.ts`, `tests/e2e/public.spec.ts` | PASS; access coverage expanded to Circle, savings, purchase and refund routes |
| A05 Session restoration, expiry and account switching | Bound token waits; reject wrong issuer/audience/subject; cancel old reads; clear private caches | `tests/startup-tokens.test.ts`, `tests/auth.test.tsx`, `tests/client-api.test.ts`, `tests/request-cache.test.ts` | PASS controlled sessions; no email-based identity merging |
| A06 Logout | Invoke Auth0 logout, clear private client state, preserve an actionable logout failure | Auth tests and callback browser scenario | PASS controlled provider |
| A07 First-time onboarding | Validate required name/email/currency and savings choice; save once; initialize zero wallets | `tests/onboarding.test.tsx`, `tests/auth0-server.test.ts`, `tests/e2e/onboarding.spec.ts`, `tests/bootstrap.test.ts` | PASS; no production account creation |
| A08 Returning/interrupted onboarding | Restore owned profile; avoid reinitializing balances; handle retry and account changes | Onboarding/bootstrap/auth tests | PASS controlled persistence; actual tenant journey E07 unverified |
| A09 Contact profile vs login identity | Contact email does not change sign-in identity or manufacture email verification | Onboarding/server-auth tests | PASS |

## Wallet and purchases

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| W01 USD/ILS/JOD wallets | Separate available/savings balances; two/two/three decimals; no fabricated startup balances | `tests/finance.test.ts`, `tests/bootstrap.test.ts`, `tests/progressive-loading.test.tsx` | PASS |
| W02 Dashboard/display currency | Display conversion uses observations without moving wallet funds; charts and goals load independently | Dashboard, progressive-loading and startup tests; `tests/e2e/dashboard.spec.ts` | PASS |
| W03 Purchase validation | Reject zero, negative, excessive precision, malformed amounts and insufficient purchase-plus-round-up funds | Finance, savings quote, SQL Circle and journey tests | PASS; insufficient funds remain an action-level message |
| W04 Purchase atomicity/idempotency | Matching retries return one transaction; changed payloads fail; errors leave balances unchanged | Database, savings-destinations, Circle SQL and funding/ledger tests | PASS |
| W05 Transaction activity | Filter before pagination; load older entries; inspect recorded postings and details | `tests/progressive-database.test.ts`, `tests/e2e/journey.spec.ts`, `tests/audit-ui.test.tsx` | PASS; fixed target-currency savings entries hidden by a second client filter |
| W06 Category filters | Food & drink and Education use the exact values accepted by purchase creation | `tests/audit-ui.test.tsx` | PASS; corrected incompatible default category labels |
| W07 Personal purchase refunds | Reverse exact original merchant/savings/FX postings once; reject unauthorized or duplicate requests | Finance, savings-destinations and Circle SQL tests | PASS |
| W08 Circle-linked refunds | Return merchant funds while retaining shared contributions and unanimous-return restrictions | Circle SQL tests; `tests/e2e/circles.spec.ts` | PASS |
| W09 Unavailable/private data recovery | Keep verified balances while secondary sections fail; bounded retries; no local financial fallback | Database timeout/client/progressive/startup tests and browser scenarios | PASS |

## PayPal Sandbox funding

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| P01 Funding dialog and SDK | Shared Home/Wallet dialog; load/retry SDK; honor eligibility and displayed bounds | `tests/e2e/funding.spec.ts`, `tests/paypal.test.ts` | PASS fixtures; live order probes PARTIAL |
| P02 USD/ILS precision and JOD exclusion | Accept only enabled USD/ILS; reject unsupported JOD and invalid amounts; never substitute currencies | Funding API/provider-verification/database/browser tests | PASS |
| P03 Order creation and ownership | Durable owned request, merchant binding, exact amount/currency and request-key binding | `tests/funding-api.test.ts`, `tests/funding-verification.test.ts` | PASS; actual Sandbox USD/ILS create/read succeeded without approval |
| P04 Approval/capture and ledger credit | Credit only canonical completed single full capture, exactly once | Funding API/verification/database suites and both-currency SDK browser flows | PASS fixtures; real payer approval/capture E08–E09 unverified |
| P05 Pending/canceled/failed payments | No credit; preserve recoverable attempts; check status after uncertain outcomes | Funding suites and browser tests | PASS controlled provider |
| P06 Provider/database outages and replay | Recover completed captures after lost responses/database failure; reject capture theft/mismatches | Funding API/database tests | PASS controlled provider |
| P07 Funding history and isolation | Show owned attempts/references; funding creates no savings or spending | Funding-savings/database/progressive tests | PASS |
| P08 Refund recovery | One verified full reversal; partial refunds/insufficient available balance enter review | Funding API/database tests | PASS controlled provider; actual refund E10 unverified |
| P09 Refund initiation, live money and direct JOD funding | No such controls or API service are offered | Source inventory and funding validation tests | NOT IMPLEMENTED by design; no real-money approval |

## Smart Savings and personal goals

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| S01 Goal creation/validation | Name, currency, positive target, optional date and explicit default choice; enforce ownership/maximums | Savings-destinations SQL and browser tests | PASS |
| S02 Goal browsing/progress | Keyboard, drag/swipe and selection update inspection without changing the destination | Dashboard/carousel/browser tests | PASS |
| S03 Activation with/without goals | Explicitly select/create an eligible goal; never create a destination on cancel; support explicit no-round-up purchase | Savings-switching, Circle SQL and savings-destinations browser tests | PASS |
| S04 Single default replacement | Personal→Circle, Circle→personal, personal→personal, Circle→Circle and repeat selection; reload/new browser context preserves selection | `tests/savings-switching.test.tsx`, `tests/circles-database.test.ts`, `tests/e2e/circles.spec.ts` | PASS; old allocations remain unchanged |
| S05 Round-up arithmetic | Exact multiples save zero; enforce per-currency increments, saved caps and sufficient funds | Finance and SQL suites | PASS; cap controls remain removed from Settings as requested |
| S06 Automatic conversion | Six currency directions; only round-up converts; correct minor units, metadata and exact refund | Six new parameterized Circle SQL cases; finance tests | PASS |
| S07 Quote/destination failures | Reject missing, stale, mismatched and completed destinations; explicit skip does not deduct savings | Savings-quote/Circle SQL and browser tests | PASS |
| S08 Historical assignment | Explicit same-currency reassignment preserves total funds and history; unsupported references remain reviewable | Circle SQL and historical savings tests | PASS; no new General Savings destination |
| S09 Archive/completion | Retain funds/history; stop future allocations to completed/archived goals | SQL and savings destination tests | PASS |
| S10 Goal editing | No general rename/target-edit endpoint exists | Source inventory | NOT IMPLEMENTED; not added as part of repair |

## Savings Circles

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| C01 Create/list/read | Validated fields, zero balance, ownership and member-only details | Circle SQL tests, new `tests/circles-api.test.ts`, multi-user browser journey | PASS local SQL/API; connected membership upgrade remains BLOCKED |
| C02 Public invitation preview | Limited goal metadata only; no private balances/member identifiers; expired/revoked links fail | Circle SQL and private/public router inventory | PASS controlled DB |
| C03 Logged-out invitation layout | Invitation is inside login/signup card at 375, 768, 1024, 1440px; joining still requires sign-in | New scenario in `tests/e2e/auth.spec.ts` | PASS; fixed misplaced invitation section |
| C04 Join/existing membership | Explicit confirmation; owner/current member gets existing-membership notice and Open Circle; repeat joins add no event | Invitation component, API, SQL and browser tests | PASS local; real database needs migration `202611010001` |
| C05 Invitation lifecycle/copy | Direct links only; validate token; regeneration/revocation; clipboard copy and manual fallback | Circle SQL/API/browser tests | PASS; fixed synchronous failure when clipboard API is absent |
| C06 Manual/goal contributions | Review quote; eligible source; no private/shared double counting; duplicates give one contribution | Circle SQL/API and browser tests | PASS |
| C07 Automatic Circle contributions | Honor default, quote, source currency and target completion/lock state | Circle SQL and browser tests | PASS |
| C08 Shares/progress/history | Outstanding shares equal Circle balance and signed entries; current user's totals exclude other members | SQL invariant hook after every Circle database case | PASS; connected read-only totals also reconciled |
| C09 Proposals | Only owner initiates exact immutable kind/amount/currency/destination; one reservation; lock additional contributions | Circle SQL/API tests | PASS |
| C10 Contributor approval | Every positive-share snapshot contributor must approve; missing/forged/repeated/changed votes fail | Circle SQL/API and actual two-session SQL browser journey | PASS; API execution checked before votes, after owner only, after both, and on repeat |
| C11 Reject/cancel/expire/retry | Reject/cancel/expire without spending; rollback failed transfers; retry executes once | Circle SQL tests with injected transfer failure | PASS |
| C12 Completion/return/target/owner | Pause contributions at completion; vote on target increase, returns and owner succession | Circle SQL tests | PASS |
| C13 Leave/archive/access control | Members with shares cannot leave; empty eligible Circle can archive; retain history | Circle SQL/API tests | PASS |
| C14 Refresh/navigation recovery | Ignore late data from old Circle; retry failed reads; clear obsolete errors | `tests/audit-ui.test.tsx` | PASS; fixed response race and unusable error recovery |

## Currency rates, conversion and alerts

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| F01 Live observations/source/freshness | Explicit USD/ILS and USD/JOD legs, indicative crosses, source/timestamp/market flags; no fabricated rates | Forex/currency-insight suites; live `npm run check:forex` | PASS parsing and live two-leg retrieval; independent price accuracy/licensing not certified |
| F02 Stored history | Available ranges only; no invented backfill; clear missing/stale history | Forex/market-feed tests; browser Forex scenario | PASS |
| F03 Manual conversion | Six rate directions and minor-unit rounding; preview before explicit confirm; sufficient funds; balanced entries | Finance/database and conversion browser suites | PASS; six direction assertions added |
| F04 Conversion failures/replay | Expired/changed/missing quotes, delayed preview, request-key reuse and insufficient funds cannot corrupt balances | Currency browser, finance/database and client tests | PASS |
| F05 Percentage/absolute/target alerts | Create/toggle owned alert; crossing/observation deduplication and 24-hour cooldown | Forex-alert/forex tests; rates UI/browser journeys | PASS |
| F06 In-app notices | Respect notification choice; mark read; no email/SMS/push delivery | Forex-alert, UI and account-state tests | PASS; notification checkbox now follows refreshed saved state |
| F07 Alert deletion | Existing API supports creation and enabled toggle, not deletion | `server/app.ts`, `src/Rates.tsx` | NOT IMPLEMENTED; no delete control to test |
| F08 Currency explanations | Deterministic amount impact, stale-data labeling, clear obsolete results after input changes | Currency-insights, cached-AI and browser tests | PASS fixtures; live AI blocked by key |

## Reports, settings and platform controls

| ID / feature | Expected behavior and test cases | Type and evidence | Status / result / gap |
| --- | --- | --- | --- |
| R01 Periods/timezones | Seven local days vs selected calendar month; partial periods/DST; reject invalid/future dates | `tests/report-calculations.test.ts`, report API/UI/browser suites | PASS; misleading rolling-month settings/help copy corrected |
| R02 Financial calculations | Per-currency spend/savings/refund cutoffs, goal progress, prior comparisons; no funding as spend | Report calculations, funding-savings and Circle SQL tests | PASS |
| R03 Circle report accounting | Include only current user's signed shares at cutoff; inclusive totals must not be added to subsets | Circle SQL and report tests | PASS |
| R04 AI schema/privacy/fallback | Aggregate facts only; validate structured output; handle bad JSON/timeout/quota/missing credentials without replacing calculated totals | Gemini/report-schema/API/UI/browser tests | PASS fixtures; live request BLOCKED by invalid API key |
| R05 Recommendation decisions | Explicit accept/dismiss only; reject stale/wrong-owner changes; AI cannot execute settings changes | Report API/SQL/browser tests | PASS |
| R06 Archive/pagination/download | Persist/reuse appropriate reports; load older records; JSON download matches displayed report | Progressive/report suites and expanded report browser journey | PASS; downloaded JSON financial fields verified |
| R07 Automatic report scheduler | No scheduled delivery exists | Source inventory | NOT IMPLEMENTED; frequency selects manual report type |
| U01 Settings/preferences | Save display/currency/increments/notifications; do not change balances for display preference; persist/reload | UI-refinement and journey browser tests | PASS; previous removal of cap/storage/feature panels preserved |
| U02 Workspace/sidebar | Home, Wallet, Smart Savings, Circles, Rates, Reports; Settings above Help at bottom | Expanded seven-page layout browser scenario | PASS at 375/768/1024/1440px |
| U03 Public/help/error pages | Search/filter help, legal/storage information, safe 404 and actionable auth/service/429 recovery | Public/user-copy/error/reliability/browser tests | PASS |
| U04 Dialogs/forms/navigation/accessibility | Labels, keyboard carousel, reduced motion, mobile sidebar, no horizontal overflow or captured page errors | UI/carousel/browser tests and screenshots | PASS sampled paths; no formal WCAG certification or assistive-technology study |
| D01 SQL migrations/RLS/functions | Filename order, clean install, preserve existing Forex data, privileged writes and owner-scoped reads | Wallet-setup, Supabase, database and Circle SQL suites | PASS isolated PostgreSQL-compatible PGlite |
| D02 Financial invariants | Zero ledger sum per transaction/currency; wallet balances match postings; nonnegative balances; Circle shares equal pool | New after-each Circle SQL invariant checks; funding/database suites | PASS isolated; connected read-only summary also zero issues |
| D03 Independent DB concurrency | True independent connections/production lock contention | Embedded SQL tests serialize calls | BLOCKED external case E13; not claimed as live concurrency certification |
| X01 Origin, validation, limits and diagnostics | Enforce auth/origin/header, bounded payloads, rate limits, safe errors/request references | Access/auth/server/reliability/client tests | PASS |
| X02 Secrets/configuration | No privileged key in client assets/history; forged access denied; environment files ignored | Secret scanner, auth-build check, read-only server check | PASS scanned scope; not a guarantee for all unscanned history/accounts |
| X03 Dependency advisories | Inspect installed transitive dependency risk | `npm audit --json` | 16 moderate findings, 0 high/critical; documented rather than forcing incompatible major upgrades |
| X04 Cron/shared cache | Authorized refresh coordination, quota/lease/cache reuse and provider outage handling | Reliability/forex/cached-AI/store tests | PASS local coordination; serverless deployment not exercised |

## External scenarios not completed

The following **13 scenario groups are not executed to completion** and are excluded from automated passing totals. Their fixture equivalents are covered above where available.

| ID | External scenario | Reason / boundary |
| --- | --- | --- |
| E01 | Actual Auth0 registration, including duplicate/invalid account cases | No disposable tenant test-user workflow supplied; no production account creation |
| E02 | Actual email/password sign-in and session restoration | No disposable user's credentials supplied |
| E03 | Wrong-password/existing-account behavior at hosted login | Controlled routing tested; actual provider interaction not executed |
| E04 | Password-reset email delivery and completed reset link | No test mailbox/account supplied; no mail sent |
| E05 | Actual PayPal Sandbox Auth0 sign-in/callback | No interactive test payer credentials supplied |
| E06 | Actual provider cancellation and invitation-return through hosted login | Mocked redirect/callback covered; not a provider certification |
| E07 | Hosted registration→onboarding→persistent wallet | No production account/profile data changed |
| E08 | USD payer approval→capture→persistent credit | Unapproved Sandbox order create/read only; no payer approval executed |
| E09 | ILS payer approval→capture→persistent credit | Same; merchant acceptance at capture remains unverified |
| E10 | Provider-side refund→application reversal/review | Controlled provider cases only; no actual refund initiated |
| E11 | Successful live Gemini report/currency explanation | Provider returned HTTP 400 `API_KEY_INVALID`; supplied key must be replaced |
| E12 | Two real authenticated accounts joining/voting on the connected database | New invitation migration missing; no production membership or money changes |
| E13 | Independent PostgreSQL connections under contention | Local PGlite runs real SQL but queues connections; not a distributed contention test |

Final executed counts, evidence, repairs and deployment instructions are recorded in [FULL_APPLICATION_TEST_REPORT.md](FULL_APPLICATION_TEST_REPORT.md).
