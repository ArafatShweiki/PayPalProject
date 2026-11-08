# Product enhancement audit and implementation plan

Audit date: 2026-11-06. Existing uncommitted live-test work is preserved.

| Area | Existing implementation | Classification | Planned change |
| --- | --- | --- | --- |
| Auth0/onboarding | Auth.tsx, Onboarding.tsx, bootstrap; verified identity, persisted profile | Already implemented | Preserve; add optional discovery guide |
| UI/navigation | styles.css, ui.tsx; navy, white, teal, responsive sidebar, native dialog | Implemented, some small text | Refine tokens and new layouts without replacing design |
| Coach | reports.ts, gemini-reports.ts, shared/reports.ts; historical round-up simulations | Partial | Add deterministic goal forecast and hypothetical comparison, scoped explanation API |
| Personal savings | goal_savings_entries, savings_destination_balances, quoted cross-currency round-ups | Already implemented | Reuse authoritative allocations; exclude reassignment from savings pace |
| Circles | immutable proposal snapshots, votes, direct invitations, atomic execution | Already implemented; activity poorly presented | Chronological paginated timeline, milestone deduplication, approval confirmation |
| Dashboard | progressive dashboard RPC, indicative FX, personal and own Circle shares | Partial | Clarify net spending/refunds and surface coach |
| Guidance | mandatory identity onboarding and contextual savings setup | Partial | Optional persistent checklist based on verified records |
| PayPal | durable funding orders, canonical verification, reconciliation, duplicate protection | Already implemented | Improve Sandbox guidance and demo documentation |
| Reports/AI | typed validated Gemini output, timeouts, private cache, quota and leases | Already implemented | Reuse provider infrastructure; retain calculated fallback |
| Testing/deployment | Vitest/PGlite, Playwright fixtures, isolated PostgreSQL, NodeNext/Vercel | Already implemented | Add risk-specific coverage and rendered evidence |

Implementation order: shared domain calculations and server projections; coach UI and dashboard; Circle activity/milestones/vote confirmation; discovery and Sandbox copy; regression and visual review. Add one versioned additive migration for read projections, guide state and milestone bookkeeping. Never apply hosted migrations or mutate production. All money stays in integer minor units. Model prose has no authority over dates, amounts or operations. Preserve ledger/RLS and unanimous approval. Provider testing requires configured isolated accounts; fixture tests do not establish live integration.


## Implemented behavior

### Savings Coach

`shared/coach.ts` owns forecasting and comparison calculations. `server/coach.ts` validates the SQL snapshot with Zod, calculates the outlook and requests optional Gemini interpretation. `src/SavingsCoach.tsx` renders a compact Home summary and a detailed Smart Savings section. Forecasts do not use the progressively loaded first page of transactions.

The service-only `walletwise_coach` RPC reads account goals, authoritative allocation balances, signed recent savings postings, wallet availability, and recorded spending from one PostgreSQL MVCC snapshot. Both subject and mapped user ID must match. Only owned records are returned. Existing wallet rules, quotes, ledger postings, Auth0 and Supabase remain authoritative.

The observation interval is the later of goal creation and 56 days before the snapshot. An estimate requires fourteen full days and at least three positive contributions on two distinct UTC dates. Net pace includes negative reversals and goal outflows. Assignments/reassignments of existing savings appear in balance history but do not inflate saving pace. Historical samples outside the interval or in the future are excluded. Archived, completed, overfunded, insufficient-history and nonpositive-pace states are explicit.

All financial inputs are integer minor units. BigInt arithmetic computes remaining days as `ceil(remaining * elapsedMilliseconds / (netContributions * millisecondsPerDay))`; displayed weekly pace is rounded separately. Partial observation days are retained in the calculation. Hypothetical pace uses `ceil(remaining * 7 / weeklyAmount)`. The chart steps through recorded balances, then uses a distinct dashed hypothetical line. Dates beyond a 100-year horizon are not materialized; the chart shows at most one projected year. Constant pace is an assumption, never a guarantee.

### AI and recommendations

The coach reuses `cachedExplanation`, its server-only key, fifteen-second provider timeout, distributed quota, concurrency leases and private scoped caching. It is called only on explicit Explain with Gemini, not on page load. Scope contains a hash of the account identity. No goal names, merchant descriptions, contact details or invitation secrets are sent. Gemini selects an applicable explanation from a permitted set derived from calculated states. Output must exactly match a permitted sentence, preventing model-authored financial values or dates. Provider errors, invalid output, quota failures and unavailable configuration retain the deterministic forecast. This deliberately bounds coach prose; the existing richer structured Reports explanations remain available.

Purchase-based rule recommendations reuse Reports and its historical round-up simulation. The coach links directly to that workflow. Increasing suggestions are suppressed when recorded available funds cannot cover the simulated extra savings and per-purchase ceiling. This check does not establish affordability outside the app. Accept rule now opens a native review dialog with current/proposed increment, unchanged cap, estimated effect, limitations, Cancel and Confirm.

Newly generated recommendations capture all currency increments/caps and the savings destination. The new reviewed-rule RPC compares these under wallet/profile/rule locks, checks available funds, then delegates to the existing ledger-revision-checked rule acceptance function. Old persisted suggestions retain their existing acceptance contract. There is no AI-triggered settings operation. Changing a hypothetical amount makes no API mutation.

### Savings Circles

Contributor shares and progress remain derived from the existing locked subledger. The detail view adds an accessible stacked share bar, exact text legend, active member/pending vote counts and per-member recent contribution history. Identical palette ordering is used in chart and legend; percentages and labels carry meaning independently of color.

`CircleTimeline.tsx` loads real contribution/distribution and activity events in one descending chronological stream. The service-only timeline RPC checks active membership and supports a stable timestamp/UUID cursor, 25 records per page with a look-ahead row. It returns no private wallets, personal goals or account subjects. Existing per-member detail history is the latest bounded set; the timeline loads older records.

The additive milestone table uniquely keys Circle and threshold (25/50/75/100). The existing balance trigger continues updating the same balance and member share, then atomically records newly crossed thresholds, writes activity and notifies active members. Reversals, refreshes, returns and later target increases cannot re-award a recorded threshold. Existing Circles are silently baselined from their current balance or retained reached marker at migration time; this does not invent earlier notifications or timestamps of historical achievement. Completion, target proposals and contribution returns still use existing unanimous workflows.

Approval now requires a second explicit confirmation showing immutable request terms. Expired voting controls are omitted on render; the backend remains responsible for expiry and eligibility at submission. New proposals record their creator; older proposals show that the creator was not recorded. No old creator is guessed. Authenticated invite previews also support Not Now without joining. Direct URLs, integrated login and explicit Join remain intact; no email sending was added.

### Dashboard and onboarding

Monthly spending and the daily chart now use signed merchant external postings: purchases minus merchant refunds, including Circle merchant-refund adjustments. Funding, savings and FX movements are excluded. Refunds are accounted for on their recorded date, so a month can legitimately be negative. The UI explains that result and exposes purchase/refund amounts when present. Negative chart bars remain negative; no absolute-value/clamping repair was used. Reports retain their existing cutoff-based treatment of refunded purchases, which is a different documented period view.

Total savings explicitly includes personal savings and only the current user's locked Circle shares. Its overview loading/error state prevents an incomplete Circle projection from being presented as a complete total. Wallet valuation displays a retrieval timestamp and retains the existing indicative-rate method. Archived goals are excluded from the dashboard fallback selection. The compact coach complements the wallet summary.

The optional Home checklist persists dismissal and actual page exploration in owner-scoped account state. Funding, goal creation, enabled savings and purchase steps derive from recorded backend data. Clicking a checklist action does not mark a financial step complete. Circle exploration is optional. Help Center links to resume the guide and explains the forecast, reversals and hypothetical scenarios. Completed core checklists stay hidden unless explicitly resumed.

Guide-only writes and read-only coach explanation requests do not clear unrelated in-flight private reads. All financial mutations still invalidate private reads before and after the operation. Account changes/logout still change cache scope and abort obsolete requests.

### Sandbox, design and trust

The funding dialog explains Sandbox personal accounts, separate PayPal sign-in/funding, server verification, interrupted-checkout recovery and test-money limitations. No PayPal capture, provider verification, idempotency or supported-currency rule was weakened. No developer funding endpoint was introduced.

The existing navy/white/blue-gray/teal design and sidebar hierarchy are preserved. New shared CSS variables cover ink, muted text, surfaces, borders, accent, radius and motion. New layouts use an eight-pixel spacing basis, tabular financial numbers, two/three-column desktop composition and readable single-column mobile composition. Focus styles/native dialogs are reused. Motion honors reduced-motion preferences. No template, extra dependency, decorative AI art or tracking provider was added.

Existing information pages already distinguish test funds, estimates and regulatory limitations. They require operator/legal review before a public financial launch; this work makes no certification or compliance claim.

## Migration and compatibility

`supabase/migrations/202611060002_product_enhancements.sql` depends on all preceding migrations, especially `202611060001_backend_storage.sql`. It adds private read functions, milestone bookkeeping and nullable creator metadata; wraps existing read projections; and adds reviewed-rule validation. It does not reset balances, delete history, relax RLS or replace financial commands. SQL functions use restricted search paths and service-role-only grants. Apply it first to an isolated Preview database. No hosted migration was executed in this task.

NodeNext `.js` server imports, the Express/Vercel entry, Vite, Auth0 callbacks, direct invitation URLs and Supabase-only storage are retained. No new environment variable is required. Existing `GEMINI_API_KEY`/`GEMINI_MODEL` settings control optional coach explanations; existing Auth0, Supabase, PayPal and rate-provider setup remains required.

## Limitations and remaining work

- Optional voluntary member contribution targets are deferred, as permitted by the brief. No planned amount is represented as saved money.
- Coach explanations intentionally use a small validated vocabulary. The coach routes users to existing Reports for historical rule proposals rather than introducing a second preference engine.
- Recent pace is not income, affordability, investment advice or an external-spending model. Newly funded demo accounts correctly show insufficient history.
- Milestones are once per Circle lifetime. A new target can reopen progress but does not re-award old percentages.
- No live Auth0 tenant, hosted migration, PayPal payment or Gemini provider response was newly verified. Local provider fixtures establish application behavior only. See the test report and demo guide for the external handoff.
- Accessibility review covers practical semantics, keyboard dialogs, labels, contrast-conscious new tokens and responsive screenshots; it is not a full WCAG audit.

## File inventory

Created: `shared/coach.ts`, `shared/spending.ts`, `server/coach.ts`, `src/SavingsCoach.tsx`, `src/ProductGuide.tsx`, `src/CircleTimeline.tsx`, the product migration, `tests/coach.test.ts`, `tests/coach-service.test.ts`, `tests/enhancement-migration.test.ts`, `tests/circle-timeline.test.tsx`, `tests/e2e/enhancements.spec.ts`, the four enhancement documents and screenshot evidence.

Modified application modules: `server/app.ts`, `server/progressive.ts`, `server/savings-circles.ts`, `server/supabase.ts`, `shared/types.ts`, `shared/circles.ts`, `shared/reports.ts`, `src/App.tsx`, `src/Dashboard.tsx`, `src/Circles.tsx`, `src/Funding.tsx`, `src/ReportSummary.tsx`, `src/api.ts`, `src/helpContent.ts`, `src/styles.css`.

Modified validation modules: isolated PostgreSQL runner, Circle/database/client/dashboard/report/invitation tests, browser journey/layout/Circle tests, test setup and fixture adapters. Updated README, Vercel and Supabase documentation point to this migration and current reports. Pre-existing live-test files and package/config changes were preserved.

## Final verification and handoff

409 unit/integration tests passed across 56 files. The full Chromium suite passed 41 tests; final affected Circle and layout follow-ups passed 2 and 3 tests respectively. The final local production-handler browser test passed 1 test. Isolated PostgreSQL passed 15 checks with 16 independent connections. Final TypeScript/Vite build, ESLint, plain Node ESM function smoke and the secret audit passed. Twenty synthetic screenshot artifacts are preserved. See ENHANCEMENT_TEST_REPORT.md for exact scope, earlier resolved failures and external-provider limits.

Next: review the migration and reports, apply the migration to an isolated Preview project, verify the real Sandbox/AI two-account demo under existing environment configuration, then decide on hosted rollout. No new environment variables are needed. Deployment is blocked on that manual database/provider validation, not on the local build. No commit, push, hosted migration or deployment was performed.
