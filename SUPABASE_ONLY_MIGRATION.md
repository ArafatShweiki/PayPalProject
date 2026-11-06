# Supabase-only storage migration

## Inventory before implementation

The authoritative wallet ledger, account state, savings goals/destinations, Circle membership/contributions/votes, PayPal funding and saved reports already live in Supabase. They must not be copied or rewritten by this migration.

`server/store.ts` currently selects Firebase Admin/Firestore on Vercel, SQLite locally. Its shared `read(id)` and transactional `update(id, initial, callback)` interfaces serve:

| Record / consumer | Classification / replacement requirement |
| --- | --- |
| `limit_<scope>_<shard>` / reliability middleware, Gemini quota | Expiring distributed security counters; replace with atomic SQL counters |
| `lease_<hash>` / reliability, AI, PMA/Twelve refresh and alert evaluation | Expiring distributed concurrency ownership; replace with SQL leases and fencing |
| `cache_<hash>` / account-specific AI/report calculations | Reconstructible private cache; retain fingerprint/TTL/isolation, reject stale-worker publication |
| `rates` / PMA refresh, conversions, savings quotes, charts | Historical rate snapshots with timestamps/attribution; preserve/import, no fabricated history |
| `twelve_status` / provider credits, backoff and timestamps | Shared coordination/metadata; atomic updates and fenced publication |
| `forex_alerts_checkpoint` / alert evaluation | Persistent job checkpoint; fenced update |
| `forex_snapshots` / local fallback only | History; Supabase already has `public.forex_snapshots` and `forex_history` RPC, reuse them |
| `user_<uid>` / first-use auxiliary-state import | Historical private account records; retain original import source and verified-identity mapping; SQL account_state remains authoritative |

`userUpdate` already uses versioned Supabase compare-and-swap for auxiliary goals/alerts/notices and imports an older authenticated account's legacy record only when account_state does not exist. Payment-related locks, replay checks and money mutations already run in SQL; the shared store is not a separate payment ledger. `server/report-storage.ts` already uses `ai_reports` directly.

Initialization/config consumers: `server/configuration.ts`, `scripts/check-deployment.ts`, `.env.example`, Vercel documentation, Firebase capability flags. `firestore.rules` denies browser access; Admin SDK uses IAM. Tests select isolated SQLite and embedded PostgreSQL. Existing SQLite files were found in `data/`, including `walletwise.db`; they must be inspected/exported read-only, never deleted or silently treated as empty.

No hosted migration or Firestore write/delete was performed during preparation.

## Implemented architecture

`server/backend-storage.ts` is the Supabase HTTP/RPC adapter. `server/store.ts` retains the established read/update/account interfaces; distributed counters and leases use specialized atomic SQL rather than repeatedly replacing JSON shards. Local SQLite is retained solely for explicit local/test use. Vercel refuses it and has no filesystem fallback. Firebase Admin, its dependency graph, the obsolete gRPC override and `firestore.rules` are removed. The deprecated `capabilities.firebase` response property remains false for compatibility; it does not enable or initialize Firebase.

New migration: **`supabase/migrations/202611060001_backend_storage.sql`**, after all ten previous migrations, including invitation membership. No wallet, transaction, funding, savings or Circle financial function was rewritten.

| New internal object | Purpose |
| --- | --- |
| `private.backend_records` | Versioned auxiliary JSON/cache/metadata/legacy import records; optional expiry; 4 MB per-record limit |
| `private.backend_limits` | One atomic fixed-window counter per scope and hashed identity; expiry index |
| `private.backend_lease_scopes` | Scope row used for transaction lock serialization |
| `private.backend_leases` | Owner UUID, globally monotonic fencing generation and database-time expiry |
| `private.backend_record_version` sequence | Non-reused revisions for CAS and lease generations, including after cleanup |
| `private.walletwise_check_backend_guards` | Checks current owner/generation/expiry while holding scope/lease locks through publication |

| Service-only public RPC | Behavior |
| --- | --- |
| `walletwise_backend_read` | Returns value and version; expired values are not returned |
| `walletwise_backend_cas` | Conditional insert/update; refuses stale revisions or expired ownership guards |
| `walletwise_consume_limit` | Atomic row-locked counter increment using database time; preserves allowed/retry metadata |
| `walletwise_backend_lease` | Acquire, renew or release; limits slots and duration; wrong/expired owners cannot renew/release a successor |
| `walletwise_store_observation` | Validated, idempotent historical observation publication with optional lease guards |
| `walletwise_backend_account_cas` | Fenced versioned auxiliary account updates during alert jobs; no ledger changes |
| `walletwise_cleanup_backend` | Bounded expiry cleanup, leaving financial records and historical observations untouched |

The migration reuses **`public.forex_snapshots`** for both providers and adds a provider discriminator/index. Existing rows default to `twelve`; they were previously Twelve Data rows. PMA writes preserve the complete original snapshot, source, timestamps, quotes and integer-millionth rates. Twelve history queries retain their existing time bucket behavior and explicitly exclude PMA. The PMA UI still reads its most recent 366 snapshots; the Twelve latest view still reads 240 and historical charts remain bucketed. Imported history is retained even beyond the latest UI window; no fake observations are created and no historical rows are cleaned up.

Duplicate observation IDs do not create extra rows or replace an earlier observation. Different values/provider for an existing ID are rejected. A later `fetchedAt` for the same provider observation is treated as a duplicate while preserving the original stored fetch timestamp. SQL wallets and historical financial postings are neither derived from these imports nor recalculated.

## Security, coordination and failure behavior

All four supporting tables live in the unexposed `private` schema, have RLS enabled, and revoke direct table access from browser roles and service_role. Only specifically granted service-role RPC wrappers can manipulate them. Privileged functions have an empty search_path and explicit schema-qualified objects. Browser JWTs cannot read counters, owner tokens, private AI caches or legacy auxiliary payloads. Existing financial RLS/grants are unchanged.

Rate limits are shared across instances, update in one RPC, and fail closed with the existing 503 protection error if the database is unavailable. Limit denials keep HTTP 429 and Retry-After. Identity keys are hashed; per-endpoint environment limits are unchanged. Twelve Data's credential-specific daily/minute budget metadata remains an atomic CAS record, protected by its single provider lease.

Leases use database time, row locks and unique ownership tokens, not connection-scoped advisory locks. Acquisitions serialize on a scope row; publications hold compatible scope/lease locks and validate the full active guard chain. Expired workers cannot publish caches, provider status, snapshots, checkpoints or alert account-state updates after a successor acquires ownership. Releases require owner and generation, so an old release cannot delete the successor. Renewal checks current ownership and rejects expired reservations. Provider refresh, cache generation and alert scopes allow 120 seconds; alert processing renews between users. Gemini's separate global provider lease is 60 seconds and retains its existing bounded 15/25-second provider deadlines. A crashed function needs no cleanup callback: expiry allows recovery.

The existing SQL financial locks/replay constraints remain inside the same financial transactions. Caches never become financial truth. Private AI scope keys/fingerprints preserve user, provider/model and input isolation. A SQL cache hit is a single read RPC; cache generation rechecks after acquiring its lease to avoid duplicate work from a just-completed peer. Conflicted auxiliary CAS callbacks may rerun up to twelve times; they must be synchronous and side-effect free. Network/uncertain RPC failures are not retried automatically. No financial mutation retry policy was changed.

Cleanup deletes at most one configured batch (default 500, maximum 1000) from each expired counter/cache class and inactive lease scopes. The daily authenticated cron runs it before provider refresh; 2% of counter requests also perform a bounded 200-row cleanup to keep pace under traffic. Revision generations are never reused, preventing stale version/lease ABA after cleanup. Historical observations and durable legacy records have no automatic deletion. Monitor churn/retention and database capacity rather than assuming a particular traffic scale fits a free plan.

Production uses the existing Supabase service client over bounded HTTP requests (default 8 seconds, maximum 15 seconds). No new database URL, TCP pool, connection leak, persistent disk, paid queue or always-running process is required. Locks last only for each SQL RPC transaction. Existing Vercel API routing, cron authentication, frontend output, Auth0 and Sandbox endpoints are retained.

## Source data found and preserved

A read-only export of `data/walletwise.db` found **27 source records**. Its validated offline plan contains **194 historical rate observations**, **4 durable auxiliary records**, and **21 transient records** excluded from import. The source SQLite database and all its original records remain unchanged. Other files in `data` are named test/smoke databases; retain them and review their provenance before deciding whether any additional export is needed. No test/synthetic observation was merged into hosted history.

The private export is at `.temp/legacy-storage/walletwise-readonly.json`, which is ignored by Git. It contains private auxiliary data; do not commit, upload publicly or paste it into logs/chat. No destination writes were made. Read-only destination schema inspection found the existing invitation functions now visible, but all seven new backend-storage RPCs absent. Apply the new migration yourself after review before import/cutover.

Firestore contents were not assumed empty. Without an explicitly supplied legacy service-account file, the exporter makes no Google request. Use the optional read-only REST extractor below if a historical Firestore deployment existed. The application and ordinary deployments no longer need Google database credentials or the Firebase SDK.

## Export, dry run, import and reconcile

1. Back up the hosted Supabase project and take a consistent legacy export. Pause the old application's writers before the **final** export/cutover so two independent coordination stores are never accepting traffic simultaneously. Wait at least the old maximum lease lifetime and provider quota windows; retain Twelve Data daily-credit metadata until its normal reset. Never import active lease ownership tokens or stale security-counter shards.
2. Apply the eleven SQL migrations, **only those missing**, in filename order to an isolated Supabase database first. Existing projects should apply the new migration incrementally; `supabase/setup-wallet.sql` is only a guarded fresh-project bootstrap. It has been regenerated and tested with the new migration. Do not reset/replay a live schema or delete financial rows.
3. Export local SQLite read-only, choosing a fresh output filename (existing files are never overwritten):

   ```sh
   npm run export:legacy -- --sqlite data/walletwise.db --output .temp/legacy-storage/local-final.json
   ```

4. If Firestore was used, give an offline service account **read-only datastore permissions**, keep its JSON file outside Git, and export the existing default database's `walletwise` collection:

   ```sh
   npm run export:legacy -- --firestore-service-account PATH_TO_PRIVATE_JSON --output .temp/legacy-storage/firestore-final.json
   ```

   This utility signs a short-lived Google OAuth assertion locally, lists documents using GET requests, decodes Firestore REST values, validates safe numeric precision, and never writes/deletes Firestore. It does not retain OAuth tokens. A successful empty list produces an explicit empty export; a 404/auth/network failure is an error, not evidence of an empty database. Both extractors refuse more than 10,000 records or a 50 MB serialized export; larger sources require a reviewed paginated/batched tool. Firestore extraction is implemented but has not been tested with a live source credential.
5. Validate the exported shapes/checksums and review the offline plan; this default dry run makes **no destination requests or writes**:

   ```sh
   npm run import:legacy -- --source .temp/legacy-storage/local-final.json --dry-run
   ```

   The plan skips reconstructible AI caches and transient locks/counters; it preserves user records, provider quota/backoff status, checkpoints and real history. Unsupported keys, unsafe values, conflicting IDs and modified checksums block import for manual review. Account identities are never merged by email. Legacy user records are copied only into private backend_records; an actual verified Auth0 identity later imports its matching auxiliary record through the existing account-state initialization path. Orphaned older identity namespaces require explicit operator review/mapping and are not reassigned automatically.
6. With the intended isolated Supabase project's existing server credentials configured, inspect the destination without writes:

   ```sh
   npm run import:legacy -- --source .temp/legacy-storage/local-final.json --verify
   ```

   Missing destination records produce a nonzero exit code and report missing counts. Current records are compared using canonical checksums; history comparisons preserve provider/source/time/precision and ignore only a duplicate's later fetch timestamp. Existing destination records with differing contents are reported, never overwritten. If importing both SQLite and Firestore, reconcile each export independently; conflicts between sources need an explicit decision.
7. After review, explicitly apply imports to the intended project hostname, then verify again:

   ```sh
   npm run import:legacy -- --source .temp/legacy-storage/local-final.json --apply --confirm-project YOUR_PROJECT.supabase.co
   npm run import:legacy -- --source .temp/legacy-storage/local-final.json --verify
   ```

   The confirmation hostname must exactly match SUPABASE_URL. `--apply` and `--dry-run` together are rejected. Imports are idempotent, conditional inserts only, with per-record reconciliation. The entire import is not one transaction: a network failure may leave a safe partial import; rerun and reconcile, never delete/reinitialize to hide it. The tool never writes wallet/transaction/ledger/funding tables or overwrites account_state. Reports include counts/conflicting IDs, not private values or credentials. `--report PATH` saves a JSON reconciliation report (choose an ignored private output path).
8. Once isolated validation succeeds, repeat reviewed migration/import steps for the intended hosted project with your authorization. Set `SUPABASE_ENABLED=true`, the established server URL/keys, and `STORAGE=supabase` (or remove STORAGE). Remove `FIREBASE_SERVICE_ACCOUNT`/other Firebase deployment variables; `STORAGE=firestore` is intentionally rejected with a migration instruction. Do not paste credentials into CLI history. Keep Auth0 origin/Action and provider setup from VERCEL_DEPLOYMENT.md.
9. Run `npm run check:database`, `npm run check:deployment`, all local checks, and a user-controlled Vercel Preview. Exercise two-user wallet/Circle permissions, cross-currency savings, invitation return/join, Sandbox recovery, reports, shared limits, stale-worker rejection, history and cron. Do not enable Production traffic until the import report has no unresolved conflicts/missing durable records.

## Rollback

Keep the legacy exports, original Firestore collection and original SQLite files. This change does not delete any of them. Stop traffic before changing adapters; never run old Firestore coordination and new SQL coordination concurrently for the same live application.

Rollback is an application/configuration operation, not a financial reset. Restore a reviewed compatible application build and its coordination configuration, then verify counters, leases and provider history before reopening traffic. Leave additive SQL infrastructure and all financial rows in place. Preserve any new observations written since cutover; export/reconcile them separately if returning to an older store. Existing wallet balances, funding IDs and transactions remain in Supabase throughout.

An old Twelve Data build that selects every forex_snapshots row is **not** safe to restore unchanged after PMA observations have been imported into the shared table: backport the `provider='twelve'` filter or use the reviewed PMA configuration until a forward fix is deployed. Do not drop the provider column, delete PMA rows or roll back financial migrations to accommodate old code. A forward application fix using the new adapter is preferred once new writes have begun.

## Configuration and implementation files

Runtime-required variables remain `AUTH0_ENABLED`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `SUPABASE_ENABLED`, `SUPABASE_URL`, public `SUPABASE_PUBLISHABLE_KEY` and private `SUPABASE_SECRET_KEY` (legacy key aliases still accepted), HTTPS `APP_ORIGIN` or the Vercel hostname fallback, and `STORAGE=supabase` or unset. Existing PayPal Sandbox, Gemini, market provider and CRON_SECRET settings keep their meanings. No Firebase key, DATABASE_URL or new storage credential is required. Explicit local/test SQLite settings remain documented separately in `.env.example`.

New files: backend adapter, SQL migration, read-only exporter, validator/importer/reconciler, real PostgreSQL test runner, legacy-import unit tests, shared browser test fixture and this migration/validation documentation. Modified files: shared storage/reliability/rate services, deployment validation, cron/error handling, package manifests, build bootstrap, configuration examples, test configurations/fixtures and relevant architecture/deployment guides. Type checking now includes all scripts. See SUPABASE_ONLY_VALIDATION.md for actual results and evidence boundaries.

## Remaining limitations

No hosted migration/import or Vercel deployment was performed. Live Firestore extraction and hosted PostgREST/privilege behavior still require operator verification. Native PostgreSQL concurrency tests use an isolated local PostgreSQL 18.6 server; Supabase's hosted version can differ, so repeat the migration in Preview. Historical data is intentionally retained without automatic destructive retention. Large all-user alert jobs still need a bounded continuation design before growing beyond a function budget. Ownership fencing prevents stale publication after lease expiry; it cannot force an external provider to cancel a request it has already accepted. Application-side quotas and deadlines remain conservative, and financial correctness continues to depend on the unchanged SQL ledger transactions.

Design references checked: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [RLS and privileged functions](https://supabase.com/docs/guides/database/postgres/row-level-security), [Vercel connection lifecycle guidance](https://vercel.com/kb/guide/connection-pooling-with-functions), and the [embedded-postgres test runner](https://github.com/leinelissen/embedded-postgres). Production uses Supabase's existing HTTP client rather than introducing a TCP pool.
