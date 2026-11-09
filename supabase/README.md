# Supabase database setup

Supabase PostgreSQL is authoritative for the financial ledger and all deployed supporting storage. Auth0 remains the only login provider. Configure the Auth0 third-party integration and Post Login role Action using [SETUP.md](../docs/SETUP.md).

## Migration order

Preserve every applied migration unchanged. Back up the intended project, inspect migration history and apply **only missing files in filename order**. Never reset a hosted project or replay a bootstrap over an existing wallet installation.

| File                                                                                                      | Purpose                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [202610260001_walletwise_core.sql](migrations/202610260001_walletwise_core.sql)                           | Wallet/ledger schema, initialization, authorization and transactional operations |
| [202610260002_wallet_preferences.sql](migrations/202610260002_wallet_preferences.sql)                     | Preferences and per-currency savings rules                                       |
| [202610260003_accept_savings_rule.sql](migrations/202610260003_accept_savings_rule.sql)                   | Atomic recommendation acceptance with revision checks                            |
| [202610290001_forex_snapshots.sql](migrations/202610290001_forex_snapshots.sql)                           | Persisted indicative market history                                              |
| [202610300001_account_state_funding.sql](migrations/202610300001_account_state_funding.sql)               | Versioned auxiliary state, durable Sandbox funding and verified reversal/review  |
| [202610300002_gemini_reports.sql](migrations/202610300002_gemini_reports.sql)                             | Report periods, fingerprints, status and history                                 |
| [202610300003_progressive_loading.sql](migrations/202610300003_progressive_loading.sql)                   | Service-only startup/dashboard/activity/report projections                       |
| [202610310001_savings_destinations.sql](migrations/202610310001_savings_destinations.sql)                 | Signed personal-goal allocation and reconciliation projections                   |
| [202610310002_goal_savings_circles.sql](migrations/202610310002_goal_savings_circles.sql)                 | Goal/Circle destinations, quotes, contributions and unanimous proposals          |
| [202611010001_circle_invitation_membership.sql](migrations/202611010001_circle_invitation_membership.sql) | Membership-aware invitation preview and explicit idempotent join                 |
| [202611060001_backend_storage.sql](migrations/202611060001_backend_storage.sql)                           | Shared Supabase records, limits, fenced leases and provider-isolated history     |
| [202611060002_product_enhancements.sql](migrations/202611060002_product_enhancements.sql)                 | Coach, guide, timeline, milestones and reviewed-rule checks                      |
| [202611080001_delete_savings_goal.sql](migrations/202611080001_delete_savings_goal.sql)                   | Atomic goal deletion/return, retained ledger identity and refund safety          |

For a linked CLI-managed project, review `supabase migration list`, then use `supabase db push` after validating the intended project and pending set. Alternatively use the SQL Editor as database owner, submitting each complete missing migration atomically. On failure, roll back and inspect rather than continuing fragments. Do not assume SQL Editor application updates the CLI's migration-history bookkeeping; reconcile that history before later CLI pushes.

The initial migration changes default privileges for future public objects owned by `postgres`; review this on shared projects and explicitly grant future objects. If another owner creates objects, equivalent default-privilege controls need review. Keep RLS, explicit owner-scoped client SELECT grants, service-only financial RPCs and the unexposed `private` schema intact.

## Guarded bootstrap

[setup-wallet.sql](setup-wallet.sql) and [its generator](../scripts/build-wallet-setup.ts) remain supported historical installation assets. The checked-in bootstrap contains the first **11** migrations, through `202611060001_backend_storage.sql`. It does **not** include the Coach/product-enhancement or personal-goal-deletion migrations.

Prefer the complete versioned migration sequence for a new installation. If using the guarded bootstrap, the starting schema must contain no wallet objects; an existing compatible `forex_snapshots` table is permitted. Run the entire file in its outer transaction as instructed, then apply `202611060002_product_enhancements.sql` and `202611080001_delete_savings_goal.sql` in order. Review migration-history bookkeeping if later using the CLI. The bootstrap aborts conflicting wallet schemas and is not rerunnable over an installed wallet. Do not regenerate or modify SQL as documentation cleanup.

## Readiness and recovery

```sh
npm run check:database
npm run check:savings
```

These checks request schema metadata without printing credentials or account rows and fail when required objects are absent. Visibility alone does not establish function bodies, grants, RLS or applied versions. For `PGRST202` / `PGRST205`, confirm the project, missing migrations, exposed public schema and PostgREST schema cache. A reviewed reload can use `NOTIFY pgrst, 'reload schema';` in the SQL Editor. Keep `private` unexposed and do not disable RLS.

[diagnostics.sql](diagnostics.sql) reads catalog metadata. `savings_reconciliation_issues` identifies orphaned/conflicting legacy allocations or ledger discrepancies; investigate without summing the issue queue as a balance or inventing corrective funds. Preserve original records. [LEGACY_STORAGE.md](../docs/LEGACY_STORAGE.md) covers read-only export, dry-run import, reconciliation and cutover/rollback.

## Local verification

`npm test` applies actual migrations in PGlite and checks roles, RLS, ownership, precision, atomicity and replay. `npm run test:postgres` uses disposable native PostgreSQL with 16 independent connections and no hosted credentials. See [TESTING.md](../docs/TESTING.md).

For an explicitly disposable local Supabase stack with Docker and the CLI:

```sh
supabase start
supabase db reset
supabase test db
```

The reset above is local-only. [tests/rls.sql](tests/rls.sql) runs its pgTAP smoke checks in a rolled-back transaction. Local simulated JWT claims follow the gateway boundary and cannot prove a hosted tenant is configured correctly. Verify actual two-account ID-token/RLS behavior in isolated Preview.

[forex-cron.sql](forex-cron.sql) is an optional reviewed Cron/pg_net/Vault recipe, not an automatically applied migration. Scheduling, provider quotas/licensing and retention are operator decisions. No hosted database change is performed by the cleanup.
