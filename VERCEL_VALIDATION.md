# Vercel validation ? Supabase-only architecture

Updated 2026-11-06. The previous hybrid Firestore report is superseded by [SUPABASE_ONLY_VALIDATION.md](SUPABASE_ONLY_VALIDATION.md).

Supabase PostgreSQL now stores deployed shared caches, limits, fenced leases, metadata and history as well as the established financial ledger. Firebase Admin/Firestore and the obsolete gRPC override are removed. SQLite is isolated to explicit local/test use and rejected on Vercel.

Local checks passed: TypeScript, ESLint, production build, 356 unit/integration tests, 14 native PostgreSQL scenarios with 16 independent connections, 36 Chromium tests, production artifact/API smoke, authentication build audit and secret scanning. Production dependencies report zero vulnerabilities; seven moderate development findings remain. See the detailed report for final clean-install evidence and file changes.

Read-only hosted metadata finds invitation functions visible and the seven new backend-storage RPCs missing. Review and apply supabase/migrations/202611060001_backend_storage.sql after its dependencies, following [SUPABASE_ONLY_MIGRATION.md](SUPABASE_ONLY_MIGRATION.md). No hosted migration/import was performed.

The original local database was exported read-only: 194 observations and four durable auxiliary records are preserved in an ignored private export; 21 transient records are skipped by the offline plan. No hosted/source data was deleted or overwritten. Live Firestore extraction is unverified because no legacy credential is configured locally.

No Vercel Preview/Production deployment or CLI build was performed. Hosted credentials/origins, PostgREST permissions, external Auth0/PayPal/Gemini flows and platform multi-instance/cron behavior remain manual checks. Follow [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) after the migration/cutover prerequisites; discard earlier Firestore environment instructions.
