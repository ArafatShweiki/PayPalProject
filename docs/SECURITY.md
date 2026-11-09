# Security and financial integrity

Dream Piggy Bank is an authenticated simulated wallet with PayPal Sandbox funding. Test balances are not bank deposits, real customer money or withdrawable funds. No live-money approval, security certification or financial/regulatory compliance claim is made.

## Identity and authorization

Auth0's SDK handles PKCE, state/nonce, origin callback, session renewal and logout. The server validates the existing app-bound ID token using RS256/JWKS, exact issuer, client-ID audience, expiry/issued-at, subject, authorized party where required and the Supabase authenticated role. The app requests no custom API audience. Identity follows verified subject, never a browser flag, caller-supplied owner or matching email.

Private requests retain onboarding, ownership, origin/header, strict input and rate-limit checks. Public configuration and limited invitation previews disclose no private financial records. Viewing an invitation does not join a Circle. Tokens are random, stored as hashes and expire/revoke; only an explicit authenticated join creates membership. Private cache generations are cleared/canceled on logout and account changes.

The existing Auth0 browser local-storage cache retains its XSS tradeoff. Maintain CSP and dependencies; do not describe it as a new server cookie/session system. Hosted Auth0/Supabase configuration and two-user gateway/RLS still require actual environment-specific checks.

## Database controls

- Subject-scoped RLS and explicit SELECT grants protect browser-visible owned records. Browser roles cannot write balances or execute privileged financial commands.
- Financial mutations use narrowly granted server/service-role RPCs with restricted search paths. Supporting counters, caches and leases live in the unexposed private schema with service-only wrappers.
- Monetary values use safe integer minor units: USD/ILS hundredths and JOD thousandths. Validated quotes preserve provenance and round half-up once to destination precision.
- Locks, per-currency balanced postings, sufficient funds and atomic commits prevent partial financial state. Request IDs/fingerprints and unique provider IDs enforce replay constraints; altered requests cannot reuse a key to move additional money.
- Circle contributions retain individual ownership. Immutable proposal terms and positive-share contributor snapshots require every required approval. One active reservation pauses contributions; reject/expiry prevents execution. Private refunds never take Circle funds.
- Goal archival, deletion, historical assignment and refunds preserve signed ledger references. No cleanup may invent funds, recalculate history or erase applied migrations.

Supabase shared limits fail closed on unavailable storage. Database-time expiring leases use ownership tokens and fencing; stale workers cannot publish over successors. Versioned auxiliary CAS preserves concurrent updates. Bounded cleanup excludes financial/history records. The existing APIs and financial RPCs remain the authorization boundary.

## Provider and AI boundary

Sandbox funding verifies canonical merchant/order/capture, exact amount/currency, owner binding, status and unique capture before a transactional credit. Callback parameters cannot authorize funds. Reconcile the original attempt after uncertainty; full verified refunds reverse once, while partial/insufficient cases enter review. No unattended refund/webhook worker is implemented. See [funding recovery](SETUP.md#interrupted-funding-and-refunds).

Gemini receives calculated, minimized facts without credentials, contact information or raw merchant/goal identifiers. Structured/schema/content validation rejects unsupported output. The Coach permits only calculated-state interpretations; deterministic amounts/dates stay authoritative. AI cannot execute financial operations. Rule acceptance is explicit and checks current rules, destination, available recorded funds and ledger revision. Report requests set `store: false`; operators remain responsible for reviewing provider data terms.

Market observations are indicative and timestamped. Stale/missing quotes cannot silently become executable prices. Provider availability or API success does not establish display/storage licensing or independent accuracy.

## Secrets, scans and dependencies

Keep `.env*` (except `.env.example`), provider credential JSON, `.vercel`, databases/backups, legacy exports, recovery journals and raw private browser artifacts out of Git. Never prefix privileged variables with `VITE_`. Public Auth0 identifiers, Supabase publishable details and PayPal Client ID are not server secrets. Do not log bearer tokens, provider bodies or account records.

Run `npm run check:secrets` after a production build and inspect `git diff --check` / `git status --short` before committing. The scanner covers known configured values and selected signatures in the available source, browser output and Git history; a passing scan is bounded evidence, not proof against every unknown or remote exposure. If actual credentials are exposed, rotate them and review the affected history/deployments; deleting a local reference alone does not revoke them.

Run `npm audit` and `npm audit --omit=dev` against the committed lockfile. The cleanup baseline reported seven moderate **development-tooling** findings in the `typescript-eslint` / `minimatch` chain, including [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Its indicated fix crosses the installed transitive major range. No forced upgrade or broad override is justified by a cleanup; track a compatible upstream update and repeat relevant checks. Audit results change over time and must be rechecked before release.

## Remaining operational limits

Public support/operator identity, retention/deletion commitments and legal notices need owner review before a financial launch. No self-service account deletion, comprehensive account export, automatic report delivery, email/SMS/push notification system or external payout is implemented. Financial reports can require complete owned history; large user-alert scans and retained observations need capacity planning. A sandbox demo is not a production financial service.

Preserve backups and originals during any migration. Recovery/import/rollback procedures are in [LEGACY_STORAGE.md](LEGACY_STORAGE.md). [TESTING.md](TESTING.md) distinguishes local proof from outstanding hosted/provider checks.
