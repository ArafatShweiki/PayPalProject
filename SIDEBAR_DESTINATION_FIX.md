# Sidebar placement and Smart Savings destination switching

Implemented locally on 2026-10-31. No production deployment or live database mutation was performed.

## Root cause

The UI had inconsistent selection and display behavior. A Circle's **Use for Smart Savings** button saved immediately, while clicking a personal goal card only inspected the goal. Its actual save action was hidden inside **Goal options**. The carousel also initialized its local selection from `selectedGoalId` only once, ignoring later changes to that prop. Finally, the destination panel displayed the default from its independently fetched options response, rather than the confirmed preference already held by the application. This allowed the visible selection/default to lag behind a successful change.

The existing API and SQL were inspected. `PUT /api/savings/destination` already invokes `walletwise_set_savings_destination` for both kinds. That function replaces the entire `profiles.wallet_preferences.savingsDestination` object with `{ kind, id, currency }`. There is no separate active personal default and Circle default in that path. Real-SQL regression tests confirm that the setter supports both directions; no database overwrite restriction was found.

## Changes

- Settings now appears in `.sidebar-bottom`, directly above Help Center and the profile. The same navigation landmark includes all workspace and bottom links. Existing Settings icons, active/hover classes and hash routing are retained.
- The navigation uses a flex column with an automatically pushed bottom section. On short screens, navigation scrolls within the available sidebar height, keeping the brand visible and preventing overlap.
- The personal carousel now exposes **Set as default savings goal** directly beside the selected goal's details. Inspecting a card still does not change financial preferences. Later explicit selection changes update and center the carousel.
- The shared setup selector groups eligible personal goals and Savings Circles, retains both groups after switching, and refuses to preselect an unavailable stored destination. If no eligible destinations exist, it opens explicit goal creation.
- Confirmed destination responses immediately replace the application's preference. The destination panel uses that preference to identify the current item in its eligible options. The normal server refresh then reloads persisted preferences and related data. A failed write never applies the attempted destination locally.
- The selector and direct personal save path use submission guards. The selector disables its fields and displays **Saving…** while a request is in progress. Existing success notifications and error displays remain in use.
- Unmounted setup requests cannot update component state. Goal creation from setup passes the confirmed created destination to the same application update path.

## Financial behavior and persistence

The SQL setter and eligibility functions are unchanged. A default change updates preferences and saving-rule activation only; it creates no financial postings, does not move historical savings, and does not alter existing Circle contributions. No General Savings account is created.

Purchase quote generation reads the one persisted destination. Execution validates the destination and quote under the existing financial locks. Future round-ups therefore use the newly selected goal or Circle and its currency, through the existing verified conversion flow. Reload and returning-session bootstrap obtain the same preference from Supabase. Archived, completed and inaccessible Circles remain excluded by server-side eligibility checks.

## Validation

- `npm run typecheck`: passed after correcting the new test fixture's required historical currency fields.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: 47 files, 322 tests passed.
- `npx playwright test --workers=4`: all 35 browser tests passed.

New UI tests cover both destination groups, duplicate submission prevention, failed-save preservation, immediate display of a newly confirmed default while options refresh, unavailable defaults, and explicit creation with no eligible goals. The carousel regression verifies a changed selected-goal prop without performing a financial write.

New real-SQL tests cover Personal → Circle, Circle → Personal, Personal → Personal, and Circle → Circle. They verify that each preference change leaves wallets, ledger counts and existing Circle shares unchanged, that both destination kinds remain available, and that subsequent ILS round-ups use the selected destination and its currency. Invalid archived/completed/inaccessible selections preserve the previous valid default.

The browser switching regression performs all four transitions, reloads after each save, injects a failed save, opens a fresh browser context for the same test account, and completes an ILS purchase saving USD to the newly selected personal goal. Existing Circle funds stay unchanged. The existing Circle purchase/contribution/voting test and USD/ILS/JOD financial tests also pass.

Sidebar geometry and routing were checked at 1440×1200, 820×900, 390×740, 390×420 and 1440×450. Desktop and short-mobile sidebar screenshots were visually inspected. All existing funding, Auth0, reporting and other browser regressions passed as part of the full suite.

SQL/browser financial tests use local PGlite with the real migrations, test identities, and explicitly labeled fixture rates. They do not establish live Supabase/payment-provider behavior or independent-connection PostgreSQL contention.

## Files changed in this follow-up

Production:

- `src/App.tsx`
- `src/Circles.tsx`
- `src/SavingsSetup.tsx`
- `src/SavingsCarousel.tsx`
- `src/styles.css`

Regression tests:

- `tests/savings-switching.test.tsx` (new)
- `tests/dashboard.test.tsx`
- `tests/circles-database.test.ts`
- `tests/e2e/circles.spec.ts`
- `tests/e2e/layout.spec.ts`

Documentation: `SIDEBAR_DESTINATION_FIX.md` (this file).

## Migration status

No new Supabase migration or manual SQL is required for this follow-up. The existing Savings Circles migration `202610310002_goal_savings_circles.sql` remains the application's required baseline. No migration, database reset or deployment was performed.
