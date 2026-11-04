# Smart Savings destinations

> Historical implementation record. The current behavior is superseded by [Savings Circles and goal-only savings](SAVINGS_CIRCLES_IMPLEMENTATION.md). General Savings is no longer a destination for new round-ups; historical balances remain preserved.

## Root cause found in the source and schema

Round-ups without a goal were **already credited** to `wallets.savings_minor` and balanced `ledger_entries` with account `savings`. The purchase transaction simply had no `metadata.goalId`. The existing overall savings total included that money, but there was no named General Savings destination or separate balance for it. Goal cards showed only earmarked amounts. No replacement funding or reconstructed transactions were necessary.

Other problems were found in the same path:

- Goals lived in Supabase `account_state.state.goals`, while the relational `savings_goals` and `savings_allocations` tables were not used by the application purchase flow.
- Every newly created goal became the default, without an opt-in control.
- The server calculated savings and read the selected goal before entering the database financial transaction. It did not validate goal completion or archival, and did not honor a disabled currency rule independently of the global setting.
- Default changes were not exposed as a per-currency clear/set operation.

These findings describe the checked-in code and the historical fixtures exercised by the tests. Production records were not queried.

## Implementation

General Savings is a permanent ledger subaccount for each wallet currency. `savings_destination_balances` projects signed savings postings: entries without a goal belong to General Savings; entries with a goal remain with that goal. It returns a zero General Savings row for each initialized currency. It does not create a second spendable balance, copy transactions, or add allocations to a separate total. The view is read-only, inherits the source tables' ownership RLS, and cannot be deleted through the app.

`walletwise_purchase` reads the global opt-in, currency rule, and default under the same financial locks used for the ledger posting. It calculates integer round-ups with the existing increment/cap rules and delegates the balanced posting to the existing idempotent financial function. A valid, owned, matching-currency, non-archived, incomplete goal receives the round-up; otherwise General Savings receives it. A purchase may reach or exceed the target with its full round-up, as before; later purchases use General Savings. A completed default is cleared. Failures roll back postings and preference cleanup together.

Each successful nonzero round-up has `metadata.savingsDestination` and, for a goal, `metadata.goalId`. The savings ledger posting is its allocation record. Refunds continue to reverse the original postings and goal reference, even after a default changes. The legacy positive-only `savings_allocations` table is not populated with duplicate records.

Defaults remain in `profiles.wallet_preferences.goalIds`: one JSON map entry per currency. The database preference function validates the destination and merges only supplied currencies while holding financial locks. JSON null clears that currency. Goal creation and optional default selection happen in one database transaction, with request-key/fingerprint idempotency. Archiving is the app's deletion behavior: it clears the default and retains the goal, saved funds, and history. General Savings has no archive/delete operation.

The existing goal carousel remains. It has a Default goal indicator and Goal options for setting/clearing a default or archiving. Create Savings Goal has an unchecked, optional “Make this my default savings goal” control. The inspected card survives data refreshes and stays visible after resizing. General Savings cards show their own balance and the inclusive savings total. Purchases have no destination picker or additional savings confirmation. Transaction details show the recorded savings destination.

Dashboard savings totals continue to use authoritative wallet savings balances, including all destinations. Goal totals and General Savings use signed ledger postings, including refunds, independently of paginated activity. Reports retain period automatic savings and add total savings/General Savings balances at the reporting cutoff. Gemini receives both verified fields, with an updated prompt that forbids adding the subset to the total. Old reports remain compatible because the new fields are optional.

## Database migration and historical reconciliation

Apply `supabase/migrations/202610310001_savings_destinations.sql` **after the existing migrations and before deploying the updated server**. For a new installation, `supabase/setup-wallet.sql` has been regenerated from all migrations. The bootstrap is not an upgrade script for an existing wallet installation.

The migration:

- Adds `savings_goals.archived_at` without deleting data.
- Imports valid auxiliary goal IDs into relational goals, preserving existing relational rows on conflict. A trigger handles accounts copied lazily from older auxiliary storage.
- Creates the permanent destination-balance and reconciliation projections.
- Adds atomic purchase, goal-create/default, and goal-archive functions, and validates legacy preference callers.
- Updates the dashboard projection and aligns AI rule acceptance with the wallet → profile → rule lock order.
- Keeps financial writes restricted to service-role functions and leaves Auth0-subject RLS ownership intact.

Historical savings postings with no goal are exposed as General Savings **without modifying any transaction or wallet balance**. Orphaned goal references stay earmarked to their recorded reference; they are not silently reassigned. Invalid/conflicting auxiliary goals, unexplained legacy allocation rows, and wallet-versus-savings-ledger discrepancies remain available for manual review:

```sql
select auth0_sub, currency, goal_id, issue, amount_minor
from public.savings_reconciliation_issues
order by auth0_sub, currency, goal_id;
```

Do not sum this issue queue as a financial balance: multiple diagnostics may describe the same record. Investigate an issue before any corrective posting. No production issue count is reported because no live database audit was executed.

## Validation

The automated suite covers no-goal allocations, optional default creation, replacing/clearing defaults, independent currency defaults, completed/archived/deleted defaults, caps, opt-out, failed purchases, duplicate request keys, competing purchases, concurrent request submission, exact signed ledger balances, refunds, historical preservation, late legacy-goal import, reconciliation diagnostics, RLS isolation, dashboard totals, API ownership, reports, and AI-compatible inputs.

Database tests execute the actual migrations and functions in local PostgreSQL through PGlite. Its concurrent requests are queued by the embedded engine; this does not verify independent live PostgreSQL connections or production lock contention. Browser tests use the repository's test-only wallet fixture and mocked PayPal SDK. They cover default creation, clearing, reselecting, archiving, reload persistence, purchase/refund/report journeys, Add Funds, carousel controls/swipes, and 1440/820/390px layouts.

No live Supabase, Auth0, PayPal, or Gemini integration was exercised. Applying the migration, reviewing the production reconciliation queue, and verifying live multi-connection behavior remain deployment checks.

Completed checks: `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` (44 files, 281 tests) passed. The focused Playwright run passed all 16 tests across savings destinations, funding, dashboard, journeys, layout, and refinements. Screenshots were inspected for desktop and mobile; responsive checks also covered tablet width.

## Files changed for this task

- UI: `src/App.tsx`, `src/Dashboard.tsx`, `src/Wallet.tsx`, `src/SavingsCarousel.tsx`, `src/savings.ts`, `src/ReportSummary.tsx`, `src/styles.css`.
- Financial models/reporting: `shared/ledger.ts`, `shared/types.ts`, `shared/reports.ts`.
- Server: `server/app.ts`, `server/progressive.ts`, `server/database-state.ts`, `server/database-errors.ts`, `server/reports.ts`, `server/report-prompt.ts`.
- Database: `supabase/migrations/202610310001_savings_destinations.sql`, regenerated `supabase/setup-wallet.sql`.
- Tests: `tests/savings-destinations.test.ts`, `tests/finance.test.ts`, `tests/dashboard.test.tsx`, `tests/ui-refinements.test.tsx`, `tests/supabase-server.test.ts`, `tests/fixtures/loading.ts`, `tests/fixtures/wallet-service.ts`, `tests/e2e/savings-destinations.spec.ts`, `tests/e2e/journey.spec.ts`, `tests/e2e/dashboard.spec.ts`.
- Documentation: this report.
