# Legacy auxiliary storage migration

This workflow preserves older SQLite/Firestore auxiliary records and real rate observations when moving to the Supabase-only supporting store. Wallet balances, transactions, ledger, savings/Circle funds, funding IDs and authoritative `account_state` already in SQL are never copied, reset or recalculated by these tools. Firebase is not a runtime/deployment dependency.

## Preserve and inspect

Keep source databases, WAL/SHM files, backups, legacy exports, original Firestore records and recovery journals untouched. A historical source was not assumed empty merely because no credential was available. Files of uncertain provenance stay preserved. Private exports can contain account data and must remain under ignored private paths, never public Git or chat/logs.

Supported durable imports include existing auxiliary user records, provider quota/backoff metadata, alert checkpoints and recorded provider history. Reconstructible AI caches and transient counters/leases are skipped; never import active ownership tokens or stale security counters. Identity namespaces are preserved, not merged by email. Orphans/conflicts need operator review.

Apply the missing [versioned migrations](../supabase/README.md), including `202611060001_backend_storage.sql`, first in an isolated project. Keep only the established public schema exposed and preserve service-only wrappers/private-table restrictions. Do not use `setup-wallet.sql` over an existing wallet.

## Export and offline plan

Choose a fresh output filename; exporters refuse to overwrite an existing file. SQLite is opened read-only:

```sh
npm run export:legacy -- --sqlite data/walletwise.db --output .temp/legacy-storage/local-final.json
npm run import:legacy -- --source .temp/legacy-storage/local-final.json --dry-run
```

The default/dry-run import validates shapes/checksums and constructs a plan **without any destination requests or writes**. Unsupported keys, unsafe numeric precision, modified checksums and conflicting IDs require review. Export limits are 10,000 records or 50 MB; larger sources need a reviewed batched tool.

If Firestore was used, an optional REST extractor requires an explicitly supplied private service-account file with read-only datastore permissions:

```sh
npm run export:legacy -- --firestore-service-account PATH_TO_PRIVATE_JSON --output .temp/legacy-storage/firestore-final.json
```

The utility signs short-lived OAuth credentials locally and issues GET requests to the historical default database's `walletwise` collection. It never writes/deletes Firestore and does not retain tokens. A 404/auth/network failure is an error, not an empty-source success. Live extraction remains unverified without an authorized historical credential. Never add that file to Git.

## Destination verification and explicit import

With the intended isolated project's existing server environment configured:

```sh
npm run import:legacy -- --source .temp/legacy-storage/local-final.json --verify
```

Verification reads the destination; missing records produce a nonzero exit code. It compares canonical checksums and original provider/source/time/precision. An otherwise identical observation's later fetch timestamp does not replace the original stored observation. Records with differing contents are reported, never overwritten. Reconcile each source independently if both SQLite and Firestore existed.

Only after reviewing the plan and intended destination, the write mode requires its exact `SUPABASE_URL` hostname:

```sh
npm run import:legacy -- --source .temp/legacy-storage/local-final.json --apply --confirm-project YOUR_PROJECT.supabase.co
npm run import:legacy -- --source .temp/legacy-storage/local-final.json --verify
```

`--apply` with `--dry-run` is rejected. Imports use idempotent conditional inserts with per-record reconciliation, not a whole-export transaction. A lost network response can leave a safe partial import: rerun/reconcile instead of deleting/reinitializing. No wallet/ledger/funding table or authoritative account state is overwritten. Private legacy users remain behind service-only records until the established verified-identity import path consumes an exact matching identity. Unmapped old namespaces are never automatically reassigned.

`--report PATH` saves counts/conflicting IDs, not private values/credentials; choose an ignored private path. Never equate a successful offline plan with successful destination reconciliation.

## Cutover and rollback

1. Back up the hosted project and validate the complete process in isolated Preview.
2. Pause old writers before the final consistent export/cutover. Wait for old maximum lease lifetimes/provider quota windows; retain current Twelve Data daily-budget metadata until its normal reset. Never run old and new coordination stores concurrently for the same traffic.
3. Apply only missing migrations, explicitly import/reconcile required durable records and require no unresolved missing/conflicting records before opening traffic.
4. Set `SUPABASE_ENABLED=true`, matching project URL/keys and `STORAGE=supabase` (or unset). Remove obsolete Firebase deployment settings. Run database/deployment checks and the two-account/provider/lease tests in [DEPLOYMENT.md](DEPLOYMENT.md).
5. Keep originals and all new observations. Rollback restores a compatible application/configuration after traffic is paused; it never resets financial data or removes additive schema/history.

PMA and Twelve observations share `forex_snapshots` with an explicit provider discriminator. After PMA imports, an older Twelve reader that selects all rows is unsafe: it needs the `provider='twelve'` filter or reviewed PMA configuration. Do not remove the provider column or delete PMA/financial history to accommodate an old build. Preserve/reconcile new observations if returning to an older store; prefer a forward application fix once new writes begin.

Supporting CAS callbacks may rerun on version conflicts and must stay synchronous/side-effect free. Lease fencing blocks stale database publication, but cannot cancel an external request already accepted by a provider. Historical observations are retained without destructive automatic cleanup. Monitor size/capacity and repeat migration/HTTP/grant checks against the hosted PostgreSQL version; native local tests do not establish hosted behavior.
