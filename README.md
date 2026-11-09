# Dream Piggy Bank

An authenticated test wallet that turns simulated purchases into savings toward personal goals and shared Savings Circles. PayPal Sandbox Checkout supplies verified test funding; Gemini explains calculated financial facts.

[Open the application](https://pay-pal-project.vercel.app) · [GitHub repository](https://github.com/ArafatShweiki/PayPalProject)

All balances are test funds. This application does not accept bank deposits, hold real customer money, execute live merchant payments or offer external withdrawals.

## Features

- Separate USD, ILS and JOD wallets, transaction history, simulated purchases and refunds.
- Smart Savings with purchase round-ups, personal goals, reviewed destination changes and quote-backed cross-currency allocations.
- Savings Circles with direct invitations, contribution ownership, activity timelines, milestones and unanimous contributor approval before shared funds move.
- PayPal Sandbox funding with canonical capture verification, duplicate protection and interrupted-payment reconciliation.
- Indicative currency observations, stored history, internal conversion previews and in-app rate alerts.
- Weekly/calendar-month reports, deterministic Savings Coach forecasts, hypothetical comparisons and optional Gemini explanations.
- Auth0 email/password and PayPal Sandbox sign-in, onboarding, settings and public help pages.

## Stack and architecture

React 19, TypeScript and Vite 7 serve the frontend. Express 5 runs locally as a Node server and on Vercel through `api/index.ts`. Auth0 provides identity; Supabase PostgreSQL stores the financial ledger, account state, shared caches, rate limits and fenced leases. Gemini stays server-side. SQLite is an explicit local/test adapter. No Firebase service is required.

See [architecture](docs/ARCHITECTURE.md) and [security and financial integrity](docs/SECURITY.md).

## Run locally

Use **Node.js 24.x** and npm, an Auth0 SPA and a Supabase project. Configure separate PayPal Sandbox business/payer accounts for funding and an optional Gemini key for AI text.

```sh
npm ci
```

Copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` in a POSIX shell), fill the required settings and complete the [setup guide](docs/SETUP.md). Apply all **13 versioned migrations** in filename order using the [database guide](supabase/README.md); existing installations apply only missing migrations.

```sh
npm run dev
```

Open `http://127.0.0.1:5173`; Express listens on port 3001. Keep `APP_ORIGIN` equal to the browser origin. New authenticated accounts start with zero balances. There is no anonymous wallet or normal-use seeded account.

## Environment variables

[`.env.example`](.env.example) is the credential-free reference. Required account settings are `APP_ORIGIN`, `AUTH0_ENABLED=true`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `SUPABASE_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`. Use `STORAGE=supabase` for deployed shared storage.

Funding additionally uses `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MERCHANT_ID`; Gemini uses `GEMINI_API_KEY` and optional `GEMINI_MODEL`. `CRON_SECRET` protects scheduled refresh. Auth0's `paypal-sandbox` login connection is configured separately from Checkout. See [setup](docs/SETUP.md) for provider configuration, defaults and optional Forex settings. Never prefix private keys with `VITE_`.

## Test and build

```sh
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run test:postgres
npm run test:e2e
npm run build
npm run test:production
npm run check:node-function
npm run check:auth-build
npm run check:secrets
```

Tests exercise isolated fixtures, PGlite and disposable native PostgreSQL; local provider responses are controlled. They do not certify hosted authentication, actual Sandbox capture or live Gemini. See [testing](docs/TESTING.md) for coverage, safe live runners and outstanding external verification.

## Deployment and demonstration

Vercel uses Vite, Node 24.x, `npm ci`, `npm run build` and `dist`. Preserve the Express function export, NodeNext `.js` server imports, ordered API/SPA rewrites and authenticated cron. Follow [deployment](docs/DEPLOYMENT.md) and demonstrate financial flows only in an isolated test deployment using [the demo guide](docs/DEMO.md).

For older SQLite/Firestore auxiliary records, preserve the original data and follow [legacy storage migration](docs/LEGACY_STORAGE.md). Do not use the bootstrap over an existing wallet database.

Provider access, hosted two-account RLS, Sandbox approve/capture/refund recovery and Gemini model access still require environment-specific verification. Funding has no webhook/refund worker; alerts are in-app and report generation is manual. Forecasts and currency observations are indicative, not financial advice. Public policy/support details require owner review before a financial launch.

## License

[MIT](LICENSE). The existing license and attribution are preserved.
