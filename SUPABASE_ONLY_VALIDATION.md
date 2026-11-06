# Supabase-only validation

Date: 2026-11-06. No hosted migration/import, live financial mutation, provider setting change, Git commit/push or Vercel deployment was performed.

## Local checks

| Check | Result |
| --- | --- |
| Clean install (`npm ci`) | Passed with the updated lockfile |
| TypeScript (`npm run typecheck`) | Passed; now includes all scripts |
| ESLint (`npm run lint`) | Passed |
| Unit/integration tests (`npm test`) | 51 files, 356 tests passed |
| Native PostgreSQL (`npm run test:postgres`) | 14 scenarios passed; PostgreSQL 18.6, 16 independent database connections |
| Playwright (`npm run test:e2e`) | 36 Chromium tests passed |
| Production build (`npm run build`) | Passed; existing frontend design/bundle split preserved |
| Built API/artifact smoke (`npm run test:production`) | Passed |
| Production auth audit (`npm run check:auth-build`) | Passed; protected sections and forged browser flags remain protected |
| Runtime dependency inspection | No Firebase Admin, Firestore or gRPC dependency tree |
| Production dependency audit | 0 vulnerabilities reported |
| Complete dependency audit | 7 moderate development findings; 0 high/critical |
| Secret scan | No checked private known values/signatures found in Git history/current nonignored tree/browser output |

The complete verification was repeated after a clean install. Cold browser verification exposed duplicate React module identities when the browser-only financial fixture discovered Temporal after initial dependency optimization. The harness now imports React/createRoot through a shared Vite-transformed source module, and the complete dependency graph, including Temporal, is prebundled before navigation. The fresh optimizer run passed all 36 tests. No UI design, assertion or financial rule was weakened to address this.

## Real concurrency evidence

The native runner creates PostgreSQL in a unique OS temporary directory, applies every migration and opens **16 separate PostgreSQL connections**. It exercises the production adapter class and actual SQL RPC implementations. The transport invokes native SQL instead of hosted PostgREST; hosted HTTP/grants are a separate check. These are not mocked counters, SQLite locks or a single PGlite connection presented as concurrent sessions.

The 14 verified scenarios cover:

1. Restricted RPC execution, direct-table denial, RLS and empty privileged search paths.
2. Atomic limits across 16 concurrent callers and identity isolation.
3. Database-time window expiry and Retry-After metadata.
4. Safe database-error rejection without leaking SQL/provider details. A separate middleware test verifies fail-closed 503.
5. Eight concurrent auxiliary CAS updates without lost changes.
6. Cache user/provider isolation, expiry and stale-read handling.
7. Lease contention, owner-safe renewal/release, crash recovery and stale-worker rejection.
8. Shared AI concurrency slots and abandoned-reservation recovery.
9. The production lease runner releases on success, provider failure, timeout/cancellation; renewal and 429/Retry-After contention remain correct.
10. Idempotent concurrent observations, exact timestamps/precision/provider attribution, missing history and conflicting/invalid-record rejection.
11. Expired workers cannot publish observations or account state.
12. Fenced account CAS preserves subject ownership and versions.
13. Bounded cleanup retains durable records/history and stale versions cannot replace recreated cache records.
14. Import dry run, repeat import and conflict reconciliation use actual SQL and never overwrite existing destination state.

Existing PGlite suites additionally execute all migrations and verify wallet balancing, rollback, funding capture uniqueness, purchase/refund replay, savings defaults/FX allocation, Circle membership/shares, locked balances, unanimous approval and RLS. Financial assertions were preserved. The bootstrap test allows the additive provider column while verifying every original history field unchanged.

## Preserved data and hosted check

The read-only export of `data/walletwise.db` found **27 original records**. Its validated offline plan contains **194 rate observations**, **4 durable auxiliary records** and **21 skipped transient records**. The source was not modified/deleted. The private export is `.temp/legacy-storage/walletwise-readonly.json` and is ignored by Git. No destination requests/writes were made by that offline plan; it did not claim successful destination reconciliation. Prices are preserved as originally recorded, not independently verified or fabricated.

Read-only hosted Data API metadata now shows the invitation-status/join functions visible. It reports all **seven new backend-storage RPCs missing**, consistent with the new migration not having been applied. Metadata does not prove hosted SQL bodies, grants, RLS or migration-history versions. No hosted migration was applied.

No legacy Firebase service-account credential is configured in the inspected local environment. Live Firestore extraction was not performed; this does not establish that a historical collection is empty. The REST extractor's decoding/precision/validation is tested locally, but live OAuth, IAM and pagination require an operator-supplied read-only credential if Firestore was used.

## Vercel compatibility and verification boundary

Vercel uses `STORAGE=supabase` or unset with Supabase enabled. SQLite is explicit local/test only and rejected on Vercel; `STORAGE=firestore` returns a clear migration instruction. No Firebase credential is required. The existing Express `api/index.ts` export, Vite `dist`, Node 24, API/SPA routes, Auth0 flow and daily authenticated cron are preserved. Supabase requests use bounded HTTP; no TCP pool, session lock or persistent function filesystem is needed. Native test binaries are development-only and never imported by the function.

Cron cleans bounded expired infrastructure before refreshing rates; counter traffic also samples cleanup. Financial rows and historical observations are excluded. The production smoke test uses the actual function export locally with its isolated adapter; native SQL tests separately exercise the new deployed adapter.

**Verified on Vercel Preview: none.** No Vercel CLI build/deployment was run. Hosted packaging, cold starts, PostgREST/grants, production cron and actual platform multi-instance behavior remain manual Preview checks.

## Files created

- `supabase/migrations/202611060001_backend_storage.sql`: atomic supporting-schema migration, restricted RPCs, history isolation and cleanup.
- `server/backend-storage.ts`: Supabase records/CAS, counters, fenced leases, observations and account publication.
- `scripts/legacy-storage.ts`, `scripts/export-legacy-storage.ts`, `scripts/import-legacy-storage.ts`: validation/checksums, read-only extraction, dry run, conditional import and reconciliation.
- `scripts/test-backend-postgres.ts`: native PostgreSQL concurrency/security/import tests.
- `tests/legacy-storage.test.ts`, `tests/fixtures/browser.tsx`: import regression tests and consistent React module identities.
- `SUPABASE_ONLY_MIGRATION.md`, `SUPABASE_ONLY_VALIDATION.md`: inventory, design, rollout/rollback and evidence.

## Files modified or removed

| Files | Changes |
| --- | --- |
| `server/store.ts`, `server/reliability.ts` | SQL selection, specialized counters/leases, efficient cache reads and fenced publication |
| `server/forex-store.ts`, `server/forex.ts`, `server/rates.ts` | Shared history/provider isolation, guarded writes, bounded provider leases and alert renewal |
| `server/app.ts` | Cron cleanup, no Firebase initialization, Retry-After on distributed lease denials |
| `server/configuration.ts`, `scripts/check-deployment.ts` | Supabase-only cloud prerequisites |
| `server/auth0.ts`, `shared/types.ts` | Accurate commentary; deprecated capability remains false for response compatibility |
| `package.json`, `package-lock.json` | Firebase removal, development-only PostgreSQL tooling, migration/test scripts, obsolete gRPC override removed |
| `.env.example`, `tsconfig.json`, `vite.config.ts` | New adapter example, script type checking, deterministic prebundling |
| `scripts/build-wallet-setup.ts`, `supabase/setup-wallet.sql` | Regenerated guarded bootstrap retaining its outer transaction |
| `tests/configuration.test.ts`, `tests/reliability.test.ts`, `tests/wallet-setup.test.ts` | New configuration, fail-closed middleware and additive schema checks |
| `tests/e2e/fixtures.ts`, `tests/e2e/onboarding.spec.ts`, `tests/e2e/circles.spec.ts` | Shared transformed browser harness imports |
| `README.md`, `VERCEL_DEPLOYMENT.md`, `VERCEL_VALIDATION.md`, `PRODUCTION_READINESS.md`, `FOREX_INTEGRATION.md`, `supabase/README.md` | Current Supabase-only guidance |
| `AUDIT_REPORT.md`, `FUNDING_IMPLEMENTATION_REPORT.md` | Historical Firestore instructions marked superseded |
| `firestore.rules` | Removed; no remaining runtime consumer; remote rules/collections unchanged |

## Manual prerequisites and remaining limits

Apply the new migration to an isolated Supabase project, reconcile required legacy sources, then perform the reviewed hosted cutover in SUPABASE_ONLY_MIGRATION.md. Change cloud storage configuration and remove obsolete Firebase settings. Preserve originals and do not restore an incompatible old Twelve Data reader after importing PMA rows.

Complete live Auth0 email/PayPal login, renewal/account switching, hosted two-user RLS, actual Sandbox capture/cancel/recovery/refund, Gemini model/quota/timeout, shared SQL limits/leases, cross-currency savings, direct invitation return/join, unanimous Circle execution and cron tests on a user-deployed Preview. Mocked browser/SDK responses are not live provider evidence. Financial balances/history/permissions were not changed to simplify this migration.

Development dependency advisories remain. Large all-user alert jobs and retained history still require capacity monitoring. Imports have per-record atomicity and a size bound, not whole-export transactional atomicity. Native tests use PostgreSQL 18.6; repeat the migration in the hosted PostgreSQL version before rollout. Rollback compatibility and these limits are documented in the migration guide.
