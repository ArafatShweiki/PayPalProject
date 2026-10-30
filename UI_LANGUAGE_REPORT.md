# Product language cleanup

Completed locally on 30 October 2026.

## Changes

- Removed authentication-provider configuration instructions from sign-in errors, account loading, profile captions and Settings. People now receive plain-language sign-in and data-loading feedback, without raw database or authentication diagnostics.
- Email sign-in, registration, password reset and PayPal redirects retain their existing behavior and identifiers. PayPal sign-in explicitly says it is for test accounts only. No production-ready PayPal authentication claim was introduced.
- Payment controls say “PayPal test payment,” explain the USD 1.00 test and that it never funds the wallet, and preserve status checking. The merchant description sent to PayPal is also plain-language copy.
- Settings describes available features instead of authentication/database infrastructure. The redundant authentication card is removed. Market-source information and AI/calculated distinctions remain accurate.
- Help and information pages explain actions and limitations in ordinary language. Data handling, financial simulation, payment limits, absence of real deposits and PayPal non-endorsement remain disclosed. Storage preferences link to the detailed Cookie Policy.
- Common service errors are translated only at the presentation boundary. HTTP status, retry timing, request references, ownership checks, token handling and mutation behavior remain unchanged. Backend diagnostic error strings remain available internally.
- Removed the login security caption and its obsolete style selectors. Existing styling is retained and the remaining login content stays aligned. Demo welcome copy no longer describes internal market services.

## Files modified

Product UI: `src/Auth.tsx`, `src/App.tsx`, `src/Wallet.tsx`, `src/Settings.tsx`, `src/InfoNavigation.tsx`, `src/ReportSummary.tsx`, `src/Rates.tsx`, `src/MarketRates.tsx`, `src/styles.css`.

Copy and presentation errors: `src/helpContent.ts`, `src/infoContent.ts`, `src/errors.ts`, `src/api.ts`, `src/publicMarket.ts`, `src/demo/service.ts`.

Server: `server/app.ts` changes only the PayPal order's user-visible merchant description. Its API endpoints, request fields, payment amount, credentials and security logic remain unchanged.

Tests: `tests/auth-error.test.ts`, `tests/auth.test.tsx`, `tests/client-api.test.ts`, new `tests/user-copy.test.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/layout.spec.ts`, `tests/e2e/demo-market.spec.ts`, `tests/e2e/forex.spec.ts`.

Report: `UI_LANGUAGE_REPORT.md`.

No dependencies, environment variables, OAuth connection identifiers, database tables, migrations, RLS policies or financial formulas were changed. Provider names remain in source identifiers/imports, internal errors, configuration and developer documentation.

## Remaining appropriate disclosures

- **Privacy Policy:** Auth0, Supabase, Firestore, Google Gemini, PayPal and market-data sources identify the services involved in sign-in, records, optional explanations and market observations. Names are descriptive data-handling disclosures rather than promotional badges.
- **Cookie Policy:** Auth0 and Supabase identify necessary sign-in/browser-storage behavior and clarify that the app does not create a separate browser database-service sign-in session.
- **Product screens:** PayPal remains the name of the actual sign-in/payment option, with an explicit test-account/test-payment limit. PMA and Twelve Data remain visible as market-price sources. AI explanations and calculated summaries remain distinguished. Financial simulation disclosures remain in the relevant help, legal and transaction-confirmation screens.

## Verification

- TypeScript and ESLint passed.
- `npm test`: **180 passed across 31 files**. Includes authentication, signup/reset, PayPal redirect parameters, account ownership, database operations, local financial calculations, error copy, metadata preservation, and demo isolation.
- `npm run test:e2e -- --workers=4`: **24 passed**. All six pages were checked for unwanted infrastructure names at 1440, 820 and 390 pixels. Authentication, signup, password reset, PayPal callbacks, data restoration, notifications, reports, conversions and Demo Mode journeys passed using controlled provider responses.
- Production build and `npm run check:demo-build` passed. Production continues to exclude the demo service and reject forged demo storage.
- Desktop/mobile sign-in and mobile Settings screenshots were visually inspected. Screenshots are in ignored `test-results/`, including `auth-desktop.png`, `auth-mobile.png` and `refined-settings-390.png`.
- Frontend text audit leaves authentication/database provider names in Privacy/Cookie disclosures and internal code, rather than ordinary screen copy. Source-name matches in imports, types, service calls and diagnostic exceptions are intentional.

Live external account logins, a deployed Supabase project and actual PayPal payment execution were not exercised. Existing controlled integration tests passed; no real funds were moved. No known outstanding implementation issue.
