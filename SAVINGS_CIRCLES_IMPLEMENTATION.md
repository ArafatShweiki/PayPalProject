# Goal-only Smart Savings and Savings Circles

## Delivery and deployment status

Implemented in the existing React/TypeScript, Auth0, Supabase and PayPal Sandbox application. No production deployment or live financial write was performed.

A read-only inspection of the configured Supabase project confirmed that `walletwise_purchase` and `savings_destination_balances` from migration `202610310001` now exist. It found three wallets, thirty ledger entries, one relational savings goal, and no rows in the old `savings_allocations` table. Available and savings balances matched their respective ledger sums for ILS, USD and JOD; `savings_reconciliation_issues` reported no issues. No private account identifiers or credentials were printed. These are deployment-state observations, not a live integration test of the new feature.

The new Circles schema was absent during that inspection. **The new migration must be applied before using this server version with that database.** New flows are validated locally with the actual PostgreSQL migrations/functions, test identities and explicitly labeled test rates. Auth0, PayPal, Gemini and the live exchange-rate service were not used to move funds during testing.

## Manual SQL and migration order

For the existing database inspected in this session:

1. Run the entire `supabase/migrations/202610310002_goal_savings_circles.sql` in Supabase SQL Editor, as the database owner, in a transaction. It requires all earlier migrations, particularly `202610310001_savings_destinations.sql`.
2. Run `npm run check:savings`. This is a read-only schema check and prints missing objects without credentials or user rows. It must report `ready: true` before enabling the new server/UI.
3. Use the application's existing authenticated accounts to verify the deployed flows after the migration. No accounts or Circle balances are automatically seeded.

For a new database, use the regenerated `supabase/setup-wallet.sql`, or apply every versioned migration in filename order. **Do not rerun the bootstrap against an existing wallet database.** The forward-only upgrade uses `ALTER`, new tables, projection replacements and additional functions. It does not drop transactions, reset balances, or manufacture financial entries. Renames make this an ordered migration, not a script to rerun indiscriminately after it has succeeded.

For explicit transaction boundaries in SQL Editor, run `BEGIN;`, then the complete migration, then `COMMIT;` as one submission. If a statement fails, roll back and inspect the error; do not continue executing fragments. The migration notifies PostgREST to reload its schema. Missing-function responses now produce a specific application-update error instead of the generic loading message that obscured the previous purchase failure.

## Smart Savings setup

New automatic savings have one explicitly selected default destination, stored in `profiles.wallet_preferences.savingsDestination`, with a kind, ID and goal currency. The former per-purchase-currency `goalIds` map remains historical data and is not a fallback. Choosing a USD goal means round-ups from ILS, USD or JOD purchases are credited to that USD goal.

Activation opens goal selection or explicit goal creation. A legacy/onboarding account marked enabled without a destination is pending and is offered setup. Closing setup does not create a goal or deduct money. The first purchase also checks eligibility. A missing/completed destination prompts setup; declining allows that purchase only with an explicit zero-round-up choice. Existing valid defaults need no repeated goal-creation confirmation. A failed or expired conversion preview provides retry and explicit no-round-up choices.

Personal goal creation optionally makes the goal the default. Creation from required setup is an explicit request to create and use that goal. Archiving retains its allocations and history and pauses saving if it was the default. Completed goals cannot receive subsequent automatic savings. The existing goal carousel, keyboard controls, dragging and touch inspection remain.

No new General Savings account or goal is created. Old unassigned balances appear only as **Historical savings to assign**, with a same-currency personal-goal selector, amount review and explicit confirmation. Each assignment creates two signed savings postings in a neutral transaction: debit the historical allocation, credit the chosen goal. Total wallet savings does not change. Orphan references and inconsistent records remain in the reconciliation queue instead of being silently reassigned. The original transactions remain untouched.

## Accounting and conversion

`goal_savings_entries` gives each immutable personal savings ledger posting one allocation, keyed uniquely by its ledger-entry ID. The migration indexes existing postings without duplicating money. Valid historical goal references are retained; unknown references remain explicitly marked for review. Refunds and subsequent transfers are signed entries, not deletions.

Automatic purchases read settings and the destination under financial locks. The merchant amount remains in the purchase currency. Only the integer round-up, capped by the source currency's rule, is converted. Personal goal savings debit source available funds and credit destination-currency savings through balanced external clearing postings. The transaction records the original merchant amount, source round-up and the exact saved quote. Circle contributions debit personal funds through the same quote validation and balanced wallet transaction, but credit the Circle subledger rather than also crediting personal savings.

Quotes are issued only by the authenticated server using the existing rate service. Cross-currency quotes must satisfy the existing pair-specific freshness check. The server persists the verified source, snapshot, source/destination currencies and minor-unit amounts, rate in millionths, observation time, expiry, zero simulated fee, and rounding policy. Clients submit a quote ID, not an arbitrary rate. SQL rechecks ownership, destination eligibility, exact source amount, currency, expiry and target arithmetic at execution.

ILS/USD have two decimal places and JOD three. Conversion uses integer/BigInt or PostgreSQL numeric arithmetic and **round-half-up once to the destination minor unit**. A result below one destination minor unit is rejected without a debit. These are recorded simulated exchanges, not PayPal foreign-exchange execution. No live payout or pooled PayPal account is claimed.

Every financial operation is transactional. Available funds must cover the purchase plus saving; source personal-goal transfers must have enough allocated funds. Request IDs/fingerprints prevent duplicate postings. Purchase retries may reuse their request ID with a refreshed quote without changing the actual purchase inputs; manual contribution confirmations stay bound to their reviewed quote. Personal-goal refunds reverse original postings when the allocation remains available. Circle-linked purchase refunds return only the merchant amount; the Circle contribution stays locked. Returning Circle savings always requires unanimous approval, even when the original merchant purchase is refunded. Duplicate merchant refunds are constrained separately. An allocation already spent/distributed cannot be reversed into a negative destination.

## Circles, privacy and invitations

The new tables are `savings_circles`, `circle_members`, `circle_invitations`, `circle_entries`, `circle_proposals`, `circle_votes`, `circle_activity`, `circle_operations`, `goal_savings_entries` and `savings_quotes`.

Each Circle has a currency, target, optional date/description/Lucide cover, owner, locked balance, completion state and permanent membership records. The creator is a member. A contribution entry belongs to one member and is linked to its wallet transaction. Database triggers update the Circle balance and that member's outstanding share together. Shared totals equal signed outstanding contributions. Moving personal goal savings into a Circle removes the source personal allocation; it cannot remain spendable in both places.

Only active members can read Circle details through the API. Responses contain displayed names, Circle shares, Circle activity and votes, not members' Auth0 subjects, private wallet balances or private transactions. New financial tables have RLS and no browser write privileges. Privileged RPCs accept the subject from verified Auth0 server context; client-supplied contributor/voter identifiers are ignored. The existing auth provider, onboarding and rate-limit middleware remain in use.

Owners generate direct links using 32 cryptographically random bytes encoded as a 43-character base64url token. Only a SHA-256 token hash is stored. Invitation audit/idempotency records contain no plaintext token. Links expire after seven days, can be revoked, and are replaced on regeneration. Preview exposes only the Circle name, description, target/currency and expiry. It grants no membership or authority. Joining requires authentication, an explicit Join Circle click and server validation. A unique Circle/subject key prevents duplicate memberships.

The route is `/circles/invite/<token>` on the configured application origin. The existing Auth0 return-route allowlist explicitly permits only this token shape and known local wallet routes. Invitation state survives onboarding and returns to the join screen. Joining opens the Circle dashboard. No emails, username invitations or message-sending integrations were added.

## Unanimous approvals and completion

Only the owner initiates a withdrawal/transfer proposal. Supported destinations are existing members' simulated wallets. Target increases, return-all, return-one-contributor and owner succession use the same approval mechanism.

A request snapshots every member with a positive outstanding share, including the owner if applicable. Non-contributing members do not vote. The request fixes kind, amount, Circle currency, zero fee, destination, reason and expiry. There is no edit endpoint: cancel and create a new request to change terms. All snapshot voters receive an in-app notice and can explicitly approve or reject only their own vote. A rejection closes the request. Missing votes leave it locked. New memberships do not remove or replace voters.

One active request per Circle is enforced by a partial unique index. For the MVP, **additional contributions and changes to locked shares are paused while a request reserves the Circle**, preventing overlapping reservations or changing shares mid-vote. Merchant-only purchase refunds remain possible because they leave the Circle contribution untouched. Expiration/cancellation releases the reservation without moving money. States include Pending, Approved, Rejected, Canceled, Expired, Executing, Completed and Failed.

Execution rechecks unanimity and the unchanged snapshot under the Circle lock. It posts wallet transfers and signed reductions of contributor shares atomically, exactly once. Partial withdrawals reduce shares proportionally in Circle minor units; deterministic member-ID ordering distributes any rounding remainder, preserving the exact withdrawn total. Returns pay each contributor's actual outstanding balance in the Circle currency. If an underlying posting fails, the inner transaction rolls back all financial changes and the request remains Failed with its approved snapshot reserved for retry or cancellation.

Reaching the target sends an in-app completion notice, displays a completion state and pauses further contributions. Nothing withdraws automatically. The owner can propose a higher target, an approved withdrawal or returns. A member with an outstanding balance cannot leave; they can request a return for the owner to propose to the contributors. A non-contributor can leave. Owner succession with outstanding funds requires unanimous approval. Archiving requires zero Circle balance and no active reservation; it retains all history.

Dashboard totals include personal savings plus only the current user's outstanding Circle shares, never an entire shared pool. Reports include the same split at the reporting cutoff and the precomputed inclusive total. Report cache keys include these totals so another member's approved distribution cannot leave an unchanged private-ledger cache showing stale shares. Gemini receives these verified facts with an updated prompt that prohibits adding subsets to an already-inclusive total.

## Validation and limits

Final checks executed on 2026-10-31:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: 46 files, 314 tests passed.
- `npx playwright test --workers=4`: all 33 browser scenarios passed, including two-member real-SQL Circle voting, merchant-only refunds, first-purchase setup, cross-currency savings, funding, Auth0, reports, and responsive layouts. Circle screenshots cover 1440, 820 and 390 pixels.
- The focused Auth0 callback test also passed. An earlier eight-worker run observed three bootstrap reads where the test expected two; the final four-worker full run passed without weakening the assertion. The Reports setup-modal regression found in an earlier run was fixed before these final checks.
- `npm run check:savings`: returned `ready: false` and exit code 1 against the configured project because migration 002 has not been applied. This is an outstanding deployment prerequisite, not a passing live integration test. The check is read-only.

Tests execute the real migration and financial functions through local PGlite PostgreSQL. Browser integration tests use test-only identity/rate adapters around those functions for owner/member sessions. Other browser tests retain the repository's Auth0/PayPal fixtures. These are not live Supabase or payment-provider integration tests. PGlite queues concurrent requests; independent live PostgreSQL connection contention is not reproduced by the embedded engine, although SQL row locks, reservations and uniqueness are exercised.

The MVP deliberately uses simulated wallet transfers, zero simulated fees, same-currency historical assignment, no public Circle directory and no automatic production deployment. Circle activity currently displays the fifty most recent entries/events; durable SQL history is retained. Requests expire after seven days. Users refresh the Circle view to see another member's latest vote. Private purchase refunds never withdraw Circle savings: they refund the merchant portion only. Circle contributions return through the unanimous proposal workflow, and no unrelated member's share is used to fund a reversal. Application of the migration and live authenticated smoke testing remain deployment steps.

## Files

New production code: `server/savings-circles.ts`, `shared/circles.ts`, `src/Circles.tsx`, `src/SavingsSetup.tsx`, `src/GoalPurchase.tsx`, `scripts/check-savings-schema.ts`, `supabase/migrations/202610310002_goal_savings_circles.sql`.

Modified production code: `server/app.ts`, `server/database-errors.ts`, `server/database-state.ts`, `server/progressive.ts`, `server/reports.ts`, `server/report-prompt.ts`, `shared/ledger.ts`, `shared/types.ts`, `shared/reports.ts`, `src/App.tsx`, `src/Auth.tsx`, `src/Onboarding.tsx`, `src/main.tsx`, `src/Dashboard.tsx`, `src/Wallet.tsx`, `src/SavingsCarousel.tsx`, `src/savings.ts`, `src/ReportSummary.tsx`, `src/styles.css`, `src/helpContent.ts`, `src/infoContent.ts`, `package.json`, and regenerated `supabase/setup-wallet.sql`.

New tests: `tests/circles-database.test.ts`, `tests/savings-quote.test.ts`, `tests/fixtures/circle-ledger.ts`, `tests/e2e/circles.spec.ts`.

Updated tests/fixtures: `tests/auth.test.tsx`, `tests/database-state.test.ts`, `tests/supabase-server.test.ts`, `tests/savings-destinations.test.ts` (preserved as a migration-001 regression), `tests/fixtures/loading.ts`, `tests/fixtures/wallet-service.ts`, `tests/e2e/savings-destinations.spec.ts`, `tests/e2e/journey.spec.ts`, `tests/e2e/dashboard.spec.ts`.

Documentation: this report, `SMART_SAVINGS_IMPLEMENTATION.md` (marked superseded), and `supabase/README.md` migration instructions.
