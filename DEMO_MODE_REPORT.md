# Developer Demo Mode implementation report

Implemented October 28, 2026.

## Activate, enter and exit

Your ignored `.env.local` now explicitly includes `VITE_ENABLE_DEMO_MODE=true`. Existing authentication, Supabase and PayPal credentials were preserved.

1. Run `npm run dev` (restart an existing Vite process after changing the flag).
2. Open http://127.0.0.1:5173.
3. Click **Explore Dream Piggy Bank (Demo Mode)** beneath the authentication options. The dashboard opens at `/#Home` without an Auth0 redirect, PayPal authentication or a Supabase user.
4. Use **Exit Demo Mode** in the sidebar or Settings to clear the tab's simulated session and return to login.

To disable local access, set `VITE_ENABLE_DEMO_MODE=false` and restart Vite. The example environment defaults to disabled. Production builds disable the mode regardless of this flag.

## Data and interactions

The browser-only service supplies a simulated profile, USD/ILS/JOD opening balances, categorized purchase history, savings jars, selected goals, exchange-rate observations, calculated reports, sample savings insights and notifications. A persistent banner and contextual labels identify the simulation. No sample explanation is described as a live AI response.

The existing Home, My Wallet, Smart Savings, Currency Rates, Reports and Settings pages remain available. Profile details appear under Settings and the existing account controls navigate there.

Supported local interactions include purchases with automatic round-ups, full refunds, goal creation and selection, savings activation and rule changes, report generation, recommendation acceptance/dismissal, conversion previews and confirmation, currency insights, alert creation/toggling, simulated rate refreshes, notification read state, transaction filters and preferences. Existing financial calculations are shared with the server rather than independently rewritten.

State persists across reloads in this tab's `sessionStorage` under `walletwise:developer-demo:v1`. It never shares real account storage. Exiting clears that key and discards the local service; a later demo starts fresh. Authentication callbacks take precedence over restoring demo storage, and verified real authentication clears demo state.

## Security boundaries

- Both `import.meta.env.DEV` and the exact opt-in value `true` are required.
- The development service loads through a conditional dynamic import. Production asset verification confirms that its module, sample seed and entry button are absent, including when the flag is enabled during the build.
- Demo sessions are separate from Auth0 identity. No real identity or fake token is manufactured. Loading, authenticated, unauthenticated and development-demo session states are explicit.
- Demo API dispatch occurs before token acquisition or network requests. Unknown operations and all PayPal operations fail locally.
- The demo branch bypasses authenticated onboarding and uses the local data service. Supabase client acquisition returns null in demo mode, and its token callback also rejects demo access.
- The old anonymous server cookie fallback was removed. Private APIs require a verified Auth0 or Firebase token even if legacy `ALLOW_DEMO=true` is supplied. A forged demo cookie cannot authorize requests. Public configuration remains public, and cron retains its separate secret check.
- Auth0 login, signup, PayPal login, callback, token forwarding and logout remain intact. Supabase RLS policies, database migrations and financial credentials were not changed. No demo records were written to real Supabase.

## Existing limitations

Goal editing is not implemented in the existing application; the demo profile panel explicitly identifies it as unfinished. Goal creation and destination selection are available. Partial refunds are also unsupported. The existing profile is part of Settings, rather than a separate profile route. PayPal checkout is intentionally disabled in this local mode. Rates and insights are simulated; live PMA and Gemini requests are not made by demo actions.

## Files created

| File | Purpose |
| --- | --- |
| `src/demoSession.ts` | Development gate, isolated transport, storage key, cleanup and restoration checks |
| `src/demo/service.ts` | Sample data and local-only interaction service |
| `shared/ledger.ts` | Existing ledger logic relocated for browser/server reuse |
| `shared/reports.ts` | Existing report calculations extracted without AI/server dependencies |
| `shared/currency-insights.ts` | Existing currency calculations extracted without AI/server dependencies |
| `tests/demo.test.ts` | Gate, local mutations, idempotency, isolation, rollback and persistence tests |
| `tests/e2e/demo.spec.ts` | Browser demo entry, profile, preferences, purchase, insights, conversion, reports, notifications, exit and request isolation |
| `tests/e2e/fixtures.ts` | Explicit demo entry and isolated fixtures for existing API UI tests |
| `scripts/check-demo-build.ts` | Browser checks for disabled development/production and production asset inspection |
| `DEMO_MODE_REPORT.md` | This handoff report |

## Files modified

| Files | Changes |
| --- | --- |
| `src/Auth.tsx` | Branded entry button, separate session branch, restoration, profile information and exit |
| `src/App.tsx` | Demo banner, sidebar exit, simulation labels and disabled PayPal callback handling |
| `src/api.ts`, `src/supabase.ts` | Local dispatch before network/token access; guards against real identity/database operations |
| `src/Wallet.tsx`, `src/Rates.tsx` | Contextual labels distinguishing simulated rates and insights from live sources |
| `src/styles.css` | Login demo entry spacing and branded full-width button |
| `server/app.ts` | Unconditional rejection of anonymous private API requests |
| `server/ledger.ts`, `server/reports.ts`, `server/currency-insights.ts` | Preserve exports while sharing pure calculations with the browser |
| `.env.example`, ignored `.env.local` | Document the disabled default and enable the explicit local opt-in |
| `vite.config.ts` | Prebundle Zod to avoid a first-entry development dependency reload |
| `package.json` | Add `check:demo-build` validation command |
| `playwright.config.ts` | Enable demo explicitly for browser tests |
| `tests/api.test.ts` | Authenticate API fixtures using mocked verification; test anonymous/forged-cookie rejection |
| `tests/app.test.tsx` | Expect the explicit developer demo label |
| `tests/e2e/auth.spec.ts`, `tests/e2e/currency.spec.ts` | Keep authenticated/API UI fixtures independent of removed anonymous backend access |
| `tests/e2e/layout.spec.ts`, `tests/e2e/journey.spec.ts` | Enter demo explicitly; account for realistic sample history |
| `README.md`, `AUTH0_SETUP.md` | Activation instructions and current security behavior |

The pre-existing `.gitignore` changes and other existing workspace files were preserved. No commit or deployment was made.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed; TypeScript also passed as part of the final production build |
| `npm run lint` | Passed |
| `npm test` | 102 tests passed across 16 files |
| `npm run test:e2e` | 14 Chromium tests passed |
| `npm run build` with local demo flag enabled | Passed; demo data service, seed and entry excluded |
| `npm run check:demo-build` | Passed: disabled development flag, production login protection, forged storage rejection and asset exclusion |
| Actual `npm run dev` smoke | Passed with isolated local API configuration: dashboard entry, no private requests, exit and backend 401 |
| Desktop/tablet/mobile layouts | All six pages passed overflow checks at 1440, 820 and 390 pixels; screenshots captured and mobile Home visually inspected |
| Auth0 regression coverage | Login/signup redirects, cancellation/reset, authenticated callback, Supabase ID-token forwarding, reload and logout passed with controlled fixtures |
| Demo request isolation | Browser recorded no private API, Supabase or PayPal requests during local actions |

The build emits Vite's non-fatal warning that the main JavaScript chunk exceeds 500 kB. Live third-party credentials and consent flows were not exercised; controlled Auth0/Supabase fixtures verified the existing integration path. No live PayPal payment or Gemini request was made.
