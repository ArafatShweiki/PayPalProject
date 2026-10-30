# Authentication fix report ? 2026-10-27

## Result

Removed the unnecessary custom Auth0 API audience. No Auth0 API, provider or backend was created. Email authorization now reaches Auth0's hosted login page in a read-only live redirect probe. Full live login is not verified. PayPal remains blocked by its disabled Auth0 connection; Supabase deployment is not ready.

The earlier recommendation to create/authorize a Dream Piggy Bank Auth0 API is superseded. The correct integration requests OIDC credentials without a custom API audience and uses the ID token for Supabase.

## Files changed in this task

| File | Change |
| --- | --- |
| `src/Auth.tsx` | Removed audience from configuration and authorization requests; shares renewed SDK ID tokens with Supabase and the existing first-party server; enabled SDK refresh-token fallback; corrected obsolete audience error guidance. |
| `src/supabase.ts` | Retains the official accessToken ID-token callback and authenticated-role guard; supports the existing non-Supabase mode without imposing a Supabase-only claim. |
| `server/auth0.ts` | Removed environment/API audience dependency; validates ID tokens with client-ID audience and JWKS; reads verified profile claims instead of sending an ID token to /userinfo. |
| `server/app.ts` | Names the authenticated request credential idToken. |
| `server/onboarding.ts` | Uses that ID token for verified profile details; existing persistence/ownership remains intact. |
| `.env.example` | Removed obsolete API audience. |
| `.env.auth0`, `.env.local` (ignored) | Removed audience assignments where present; retained other local settings and secrets. |
| `tests/auth.test.tsx` | Updated audience-free mocks; added returning Supabase profile/ID-token propagation and failed-renewal coverage. |
| `tests/auth0-server.test.ts` | Tests client-ID audience validation, obsolete API audience rejection, optional/multiple-audience azp behavior, verified profile claims, role requirement and audience-free public configuration. |
| `tests/auth-error.test.ts` | Covers both obsolete resource-server errors without recommending creation of an API. |
| `tests/supabase-server.test.ts` | Updated mocked authentication configuration and ID-token naming. |
| `tests/e2e/auth.spec.ts` | Checks real SDK email/PayPal authorization URLs omit audience; adds mocked successful callback, ID-token Supabase headers, returning profile, reload persistence and logout. |
| `scripts/check-integrations.ts` | Corrected the anonymous-request blocked indicator to inspect the anonymous result. |
| `AUTH0_SETUP.md` | Replaced outdated resource-server instructions with current integration setup and observed deployment blockers. |
| `supabase/README.md` | Updated token boundary, configuration instructions and current status. |
| `AUDIT_REPORT.md` | Marked prior audit findings as historical and linked current setup. |
| `AUTH_FIX_REPORT.md` | This report. |

Ignored production assets in `dist/` were regenerated. No schema migration, dashboard setting, dependency or visual design change was made.

## Token and ownership model

Auth0 React SDK retains PKCE, state/nonce processing, origin callbacks, logout, local-storage sessions and renewal. It no longer receives an API audience. Silent renewal's opaque access token is discarded; `getIdTokenClaims().__raw` supplies Supabase's `accessToken` callback. There is no Supabase Auth login/session creation.

The repository already has an Express server despite the task's architecture description. Keeping it preserves trusted financial operations and existing features. Its first-party endpoints now validate the app-bound ID token using RS256/JWKS, exact issuer, client-ID audience, expiry, required subject/issued-at, authorized-party rules, and the authenticated role in Supabase mode. This does not turn ID tokens into general-purpose OAuth API tokens. Existing identity mapping is unchanged: opaque Auth0 sub strings for Supabase and issuer-plus-subject hashes for auxiliary records. ID tokens are never forwarded to /userinfo.

RLS and grants remain intact. Browser users have subject-scoped SELECT access, no wallet/transaction/profile writes or privileged RPC execution. Existing server-side ownership checks and transactional financial functions remain. Keys remain server-only; the public bundle secret scan found no suspected exposures.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed, existing >500 kB bundle warning remains.
- `npm test`: 94 tests across 15 files passed, including actual signed JWT verification and PostgreSQL/PGlite RLS, grants, two-user isolation, transactions and onboarding persistence.
- `npm run test:e2e`: 12 of 13 initially passed; the new logout test used a demo-mode wallet fixture, so it waited for the wrong button label. Corrected the fixture to authenticated mode. Reran the six authentication browser tests: all six passed. Together with the seven other passing regression scenarios, all 13 scenarios are covered successfully.
- `npx tsx scripts/audit-secrets.ts`: no suspected exposure in scanned public files, generated bundle or repository history.
- Live read-only Auth0 probes: audience-free email reaches `/u/login`; audience-free PayPal returns `invalid_request: the connection is not enabled`.
- Live read-only Supabase diagnostics: all 11 Dream Piggy Bank tables return 404/PGRST205; forged token rejected with 401. Auth0 discovery/JWKS succeeds. Connectivity checks therefore do not pass overall.

External authorization/token responses are mocked in browser tests. No live email registration, password-reset delivery, completed PayPal login, ID-token role claim or authenticated hosted Supabase profile read was verified. Available connected tools do not expose Auth0/Supabase administration; no remote provider or Action configuration is claimed verified.

## Remaining actions

1. **Auth0:** enable `paypal-sandbox` for Dream Piggy Bank; keep the database connection/signup/reset enabled and Google disabled. Deploy and attach the existing Post Login Action that sets the ID-token claim `role: authenticated`. Keep RS256 and correct callback/logout/web/CORS origins. Do not create an API.
2. **Supabase:** verify Third-party Auth uses tenant `dev-arafat`, region `eu`. Confirm the configured URL/keys belong to your intended project. Check tables with `supabase/diagnostics.sql`. If missing, apply the existing three migrations in order; if present, investigate exposed public schema and schema cache. Keep private schema unexposed and RLS enabled.
3. **Environment:** remove `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE` in hosted deployment settings. Local audience assignments were removed. Local `SUPABASE_ENABLED` is currently false; set true after completing database/provider setup. Keep domain/client ID, database connection, publishable key, server-only secret, `ALLOW_DEMO=false`, and the correct `APP_ORIGIN`. Restart/redeploy.
4. **Manual test:** create an email account, complete onboarding, reload, sign out/in, and test password reset. Then repeat with a Sandbox personal PayPal account. Confirm `/authorize` has no audience, Supabase receives the ID token, the same subject retrieves its existing profile, and two identities cannot access one another's data.

Detailed dashboard steps and manual checks: [AUTH0_SETUP.md](AUTH0_SETUP.md). Official reference: [Supabase Auth0 third-party integration](https://supabase.com/docs/guides/auth/third-party/auth0).
