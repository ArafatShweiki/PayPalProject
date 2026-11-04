# Gemini financial reports implementation

Implemented in the existing Express/React report flow. No new authentication system, demo mode, external service, or client-side AI credentials were added. Existing uncommitted application and funding changes were preserved.

## Provider and deployment

- SDK: `@google/genai` 2.32.0, official Google GenAI TypeScript SDK.
- Default report model: `gemini-3.5-flash-lite`; override with server-side `GEMINI_MODEL`.
- API: Interactions with structured JSON, `store: false`, no continuation, no tools, and Zod validation. Existing currency-insight generation remains on its supported adapter.
- Google documents the selected model as stable, cost-efficient, and supporting structured output: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- Google recommends the generally available Interactions API for new work; generateContent remains supported: https://ai.google.dev/gemini-api/docs/interactions-overview
- Structured-output reference: https://ai.google.dev/gemini-api/docs/structured-output

Required server configuration:

```env
GEMINI_API_KEY=<server-secret>
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_REPORT_TIMEOUT_MS=20000
```

Use existing Auth0 and Supabase configuration, including `AUTH0_ENABLED=true`, the tenant/client settings, `SUPABASE_ENABLED=true`, the project URL, server secret and browser publishable key. Never prefix the Gemini secret with `VITE_`. Existing SQLite/Firestore infrastructure remains required for shared protection and short caches; retain the project's deployment configuration.

Apply all existing migrations in order, including `supabase/migrations/202610300002_gemini_reports.sql`, through the project's Supabase migration workflow before enabling report generation. The new migration extends the existing `ai_reports` table without deleting or rewriting historical reports. It adds period boundaries, model, prompt version, input fingerprint, status, and recommendation snapshots; a unique owner/fingerprint/status index prevents duplicate saved results. Existing owner-only SELECT RLS remains active. Only the service role gains INSERT/UPDATE; browsers cannot write reports.

## Endpoints and workflow

`POST /api/reports` accepts only `{ frequency: "weekly" | "monthly", date?: "YYYY-MM-DD", timezone?: "IANA/Zone" }`. Extra fields, invalid dates, invalid timezones and future selections are rejected. No client financial totals or transactions are accepted.

1. Existing middleware verifies the Auth0 token, onboarding, origin/header, account storage and rate limits.
2. `databaseState` reads owned PostgreSQL transactions and savings rules and the existing Supabase-backed `account_state` goals and preferences.
3. Application code calculates per-currency spending, category totals, actual automatic savings, counts, rounded average purchase, previous-period spending/savings changes, goal progress, and alternative-rule simulations.
4. A fingerprint covers source records, rules, goals, calculated comparisons, report boundaries, completion status, timezone, prompt version and configured model.
5. An unchanged saved report is reused. Otherwise a versioned prompt receives aggregate facts only. Merchant descriptions, names, emails, user/goal/transaction identifiers, tokens and provider credentials are excluded. Category labels are capped and treated as untrusted data.
6. The official SDK requests structured JSON. Strict Zod validation, size limits, numeric-claim restrictions, trend checks and candidate-ID validation reject unsupported output. Model text never supplies or replaces financial fields.
7. Supabase stores the result and its status. The existing account-state archive is refreshed without duplicating the report ID or resetting a prior recommendation decision.
8. React displays verified totals separately from generated interpretations. Unavailable AI keeps calculated totals and a retry message. Incomplete/invalid output is never marked complete. Previous reports remain available in the archive.

`POST /api/recommendations/:id` retains the existing explicit `accepted` / `dismissed` decision flow. Owner lookup is mandatory. Acceptance calls the existing transactional `walletwise_accept_savings_rule` RPC, which checks opt-in, rule increment/cap, allowed doubling, and the latest actual ledger revision under locks. It cannot be invoked by model output. The UI's existing runner refreshes account data and shows a notification after a decision.

## Calculation policy

- ILS/USD use integer hundredths; JOD uses integer thousandths. No cross-currency addition or speculative exchange conversion occurs. Checked integer sums and BigInt rounding preserve precision.
- Weekly selection covers seven local calendar days ending on the selected date. Monthly selection covers the selected calendar month. The browser supplies its configured timezone; API callers default to UTC. Temporal handles DST and month lengths.
- A current period stops at generation time. Previous comparisons use the same elapsed local calendar portion, capped at the end of a shorter previous month. Missing account history produces null comparisons, never invented earlier transactions.
- Period ends are exclusive. Full refunds/reversals recorded by the reporting cutoff exclude their original purchase. Refunds after a historical cutoff do not change that historical report. Comparisons are restated using refunds known at the report cutoff, rather than treating refunds as new spending.
- Goals show saved amounts and server-calculated capped completion percentages as of the cutoff. No goal-change trend is fabricated.
- Each candidate doubles an allowed increment, preserves the current per-purchase cap, respects exact rounding boundaries, excludes refunded purchases, and compares replayed alternative savings with actual recorded allocations. Disabled rules produce no candidate. Pending funding rows are excluded from the ledger revision used for acceptance.
- Historical simulations assume the rule applies to the period's recorded, nonrefunded purchases. They do not reconstruct hypothetical historical wallet affordability or guarantee future savings. This is stated on recommendation cards.
- Qualitative model prose is deliberately conservative: numeric claims and unsupported recommendation IDs are rejected; all amounts and estimated impacts appear in trusted UI fields. Validation can reject otherwise reasonable prose. Semantic correctness of unrestricted natural language cannot be proved; explicit past-tense trend checks reject common contradictions.

## Caching, quotas and failure handling

| Control | Default |
| --- | --- |
| Authenticated AI requests (`RATE_LIMIT_AI`, shared with currency insights) | 5 per account per minute |
| Provider work (`GEMINI_REQUESTS_PER_MINUTE`) | 30 per minute across accounts |
| Provider concurrency (`GEMINI_MAX_CONCURRENT`) | 3 |
| Short private cache (`AI_CACHE_TTL_MS`) | 900000 ms |
| Report generation network timeout (`GEMINI_REPORT_TIMEOUT_MS`) | 20000 ms; hard cap 25000 ms |
| Model input | 32000 UTF-8 bytes |
| Model output | 1800 tokens and 12000 characters; schema has shorter per-field bounds |
| Transient retry | At most once, only explicit 500/502/503/504, 250-400 ms backoff |

Existing transactional SQLite/Firestore counters, cache and leases are reused. Same-process duplicates join one promise; shared leases reject concurrent work across processes instead of making another model request. Cache scope includes the verified account. Durable Supabase reuse continues beyond the short-cache TTL while the fingerprint is unchanged. Source changes, calculated comparison changes, period completion, model changes and prompt changes invalidate reuse. Failed AI output is saved as `ai_unavailable` and never cached as successful. A save failure returns a database error.

Provider retries consume the shared quota. Invalid requests, credentials, quota errors and malformed JSON are not retried. Token usage is logged when supplied by the SDK; financial facts and provider error bodies are not logged. No dollar-cost estimate is guessed because the SDK does not provide billed cost. There is no automatic report schedule.

## Verification and external limitations

Commands executed:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --reporter=dot`: 210 tests passed across 33 files on the final full run. Includes financial calculations, real SDK HTTP fixtures, Express routes with mocked Auth0/Supabase/provider boundaries, PostgreSQL migrations/RLS via PGlite, and React controls/loading/fallback/decisions.
- `npm run test:e2e -- --reporter=line`: 24 Chromium tests passed, including the new report flow, responsive layout, existing authentication, wallet, savings, funding and Forex flows. These browser tests use isolated fixtures, not live account services.
- `npm run build`: production TypeScript/Vite build passed.
- `npx tsx scripts/check-gemini-reports.ts --live`: attempted using anonymous fixture totals. The locally configured `gemini-3.8-flash` returned a configuration error; a separate attempt selecting `gemini-3.5-flash-lite` also returned a configuration error. A separate read-only SDK model-availability check returned HTTP 400 with `invalid_api_key`, confirming the configured credential is rejected. No authenticated model request succeeded. Live personalized generation remains unverified.

The local environment had a Gemini credential configured and Auth0 enabled, but Supabase integration was disabled. A replacement valid Gemini credential/model entitlement, enabled Supabase project and applied migrations are still needed for a live account test. No remote migration, production deployment, or real payment was performed. The migration was tested locally against PostgreSQL-compatible PGlite, not applied to the hosted project. Re-run the opt-in smoke script after provider configuration is corrected, then verify the full flow with an authenticated test account.

The live script makes a billable request only with `--live`; it sends anonymous fixture aggregates and prints sanitized outcome/model/status. It does not expose credentials or account data. Existing test suites emit expected Auth0 negative-path warnings; those tests pass.

## Files created

- `server/gemini-reports.ts`: official SDK adapter, structured requests, timeouts and bounded retries.
- `server/report-prompt.ts`: reusable versioned financial prompt.
- `server/report-schema.ts`: strict schema and output validation.
- `server/report-storage.ts`: owner-scoped Supabase read/write.
- `shared/report-period.ts`: timezone/calendar boundaries and comparable cutoffs.
- `supabase/migrations/202610300002_gemini_reports.sql`: report metadata and service-only persistence grants.
- `scripts/check-gemini-reports.ts`: opt-in live smoke test.
- `tests/report-calculations.test.ts`, `tests/gemini-reports.test.ts`, `tests/reports-api.test.ts`, `tests/reports-ui.test.tsx`, `tests/e2e/reports.spec.ts`: added coverage.
- `GEMINI_REPORTS_IMPLEMENTATION.md`: this implementation/deployment record.

## Files modified for reports

- `server/app.ts`: strict authenticated generation request, existing workflow reuse, archive deduplication and recommendation ownership response.
- `server/reports.ts`: structured explanation orchestration, durable cache reuse and persistence.
- `server/database-state.ts`: carries per-currency rule enablement into simulations.
- `shared/reports.ts`, `shared/types.ts`: deterministic calculations and typed report metadata/content/estimates.
- `src/App.tsx`, `src/ReportSummary.tsx`: date selection, duplicate-submit guard, skeletons, distinct AI sections, fallback, report timezone dates and recommendation details.
- `.env.example`, `package.json`, `package-lock.json`: safe server configuration and SDK/Temporal dependencies.
- `tests/cached-ai.test.ts`, `tests/database.test.ts`: Interactions fixtures and report persistence/RLS assertions.
- `tests/e2e/fixtures.ts`: unused test import cleanup; existing fixture harness retained.
- `README.md`: link to this implementation record.

Other pre-existing/concurrent workspace changes are outside this report integration's file list.
