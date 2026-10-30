# Dream Piggy Bank authentication and Supabase setup

Updated 2026-10-27. This replaces the previous instructions to create or authorize a Dream Piggy Bank resource server. Do not create an Auth0 API for this integration.

## Root cause and implementation

The app requested `https://walletwise.api` as an OAuth audience. Auth0 rejected both login methods before authentication because the client was not authorized for that resource server. The app now requests OIDC scopes (`openid profile email`, with SDK-managed offline access), its existing client ID and origin callback, and no custom API audience.

The repository already contains an Express server used by onboarding, wallet transactions, savings, rates and reports. It remains in place to preserve those features; no backend service was added. Removing this existing server would require a separate application/database redesign. Browser Supabase reads use Auth0 ID tokens directly. The existing first-party server now verifies the same app-bound ID token against Auth0 JWKS, RS256, issuer, expiry, required subject/issued-at claims, client-ID audience, and authorized party when present (required for multiple audiences). Supabase mode additionally requires the authenticated role. This is application-specific identity validation, not general-purpose OAuth resource-server access-token validation.

The original subject-to-user mapping is unchanged: Supabase uses the opaque `sub` string, and auxiliary storage uses the existing issuer-plus-subject hash. Email never merges accounts. Profile name/email/verification come from verified ID-token claims; ID tokens are never sent to Auth0 `/userinfo`.

The official Auth0 React SDK still handles PKCE, state, nonce, callback processing, logout, local-storage caching and renewal. `getAccessTokenSilently()` renews SDK credentials without a custom audience; its opaque access token is discarded. `getIdTokenClaims().__raw` supplies the token to Supabase's official `accessToken` callback and existing first-party endpoints. Refresh-token fallback is enabled for sessions without a cached refresh token. If silent renewal requires interaction, sign in again. There is no Supabase Auth sign-in or second session.

## Auth0 dashboard

Use tenant `dev-arafat.eu.auth0.com`, application Dream Piggy Bank, client ID `ZBihOfE7MZJnhoa4okJizrW9u8BK4pZz`.

1. Keep application type Single Page Application, RS256 ID-token signing, Authorization Code and Refresh Token grants, and rotating refresh tokens. No SPA client secret is needed.
2. Register the origin actually used for Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins and Allowed Origins (CORS). Local examples: `http://127.0.0.1:5173`, `http://localhost:5173`. The app redirects to `location.origin`; production needs its exact HTTPS origin. Set `APP_ORIGIN` to that same origin.
3. Enable `Username-Password-Authentication` for Dream Piggy Bank, allow signups, and configure password-reset email delivery. If using a differently named existing connection, set `AUTH0_DATABASE_CONNECTION` accordingly.
4. Enable the existing `paypal-sandbox` social connection for Dream Piggy Bank. Configure its PayPal Sandbox client credentials and Sandbox endpoints. In PayPal, enable Log in with PayPal and set return URL `https://dev-arafat.eu.auth0.com/login/callback`. Test with a Sandbox personal account, not a live PayPal account. Checkout credentials do not configure social login.
5. Keep Google disabled for this application. The application contains no Google login button or Google authorization request.
6. Deploy `auth0-actions/add-supabase-authenticated-role.js` as a Post Login Action and attach it to the Login flow. It must set `api.idToken.setCustomClaim("role", "authenticated")`. Obtain a fresh login afterward.
7. No API audience is needed. If the tenant has a Default Audience, review it: a tenant default can inject an audience even when this app omits one. The audience-free live probe currently reaches email login, so it did not encounter that blocker. Do not change shared-tenant settings blindly.

## Supabase dashboard and database

1. In Authentication > Third-party Auth, configure the Auth0 integration for tenant `dev-arafat`, region `eu`. This uses Auth0-issued ID tokens; do not configure a second email/password provider for Dream Piggy Bank.
2. Confirm `SUPABASE_URL` and both keys belong to the intended project. Keep `SUPABASE_SECRET_KEY` server-only. The browser receives only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` through `/api/config`.
3. Check Table Editor for Dream Piggy Bank's public tables. Apply the three existing migrations in `supabase/migrations` in filename order if missing. Review existing objects and back up an existing database first; do not reset or overwrite existing user data. If tables exist but the API cannot see them, check public-schema exposure and refresh PostgREST's schema cache. Do not expose the private schema or disable RLS.
4. Authenticated browser users have SELECT-only grants. RLS compares each row's text `auth0_sub` with the verified JWT subject. Privileged mutations remain in the existing server and tightly scoped transactional database functions. No browser balance writes or service secrets were introduced.

See [Supabase setup](supabase/README.md) and the [official Auth0 integration guide](https://supabase.com/docs/guides/auth/third-party/auth0).

## Environment

Keep `AUTH0_ENABLED=true`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_DATABASE_CONNECTION`, `SUPABASE_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, server-only `SUPABASE_SECRET_KEY`, and `APP_ORIGIN`. Private APIs always require verified authentication. For local-only frontend exploration, explicitly enable `VITE_ENABLE_DEMO_MODE=true`; production builds exclude it.

Remove obsolete `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE` settings from deployments. They are no longer read. The custom audience was removed from the local environment files and example. Never use a VITE prefix for secret/service-role keys. Restart the application after environment changes and rebuild/redeploy the frontend. Old audience-specific SDK cache entries are not used by the new default-audience session; sign out/in once for fresh claims.

## Live diagnostics on 2026-10-27

- Without an audience, email authorization redirects to Auth0 `/u/login` successfully. This verifies the redirect only, not completed registration or login.
- Without an audience, the PayPal flow returns `invalid_request: the connection is not enabled` after following Auth0's redirect. Enable `paypal-sandbox` for Dream Piggy Bank.
- Local effective configuration currently has `SUPABASE_ENABLED=false`. Enable it only after the database/provider setup below is complete; otherwise the existing server uses its legacy storage mode. This flag was left unchanged to avoid breaking onboarding against unavailable tables.
- The configured Supabase project's Data API returns 404 / PGRST205 for all eleven Dream Piggy Bank tables, including profiles and wallets. They are absent from its exposed schema cache. Missing migrations, wrong project, schema exposure and stale cache must be checked in the dashboard.
- Supabase rejects a forged token with 401. Auth0 discovery and RSA signing-key discovery succeed.
- No authenticated live ID token was available. The remote Auth0 Action, Supabase third-party provider, two-user hosted RLS and completed PayPal/email authentication have not been verified. No remote dashboard settings or schema were changed.

## Manual verification

1. Restart/redeploy, open the configured origin, and choose Create an account with email. Confirm the Auth0 `/authorize` request has no `audience` parameter and uses the database connection plus `screen_hint=signup`.
2. Complete registration and onboarding. Refresh, sign out and sign back in; the same profile and preferences should return. Verify password reset delivery.
3. Repeat with Continue with PayPal using a Sandbox personal account after enabling its connection. Confirm the request uses `connection=paypal-sandbox`, no custom audience, and the callback returns to the app.
4. Verify the fresh ID token has the literal `role: authenticated` claim locally without sharing the token. The browser's Supabase request must use that ID token, never the opaque access token.
5. Test two distinct identities. Each must see only its own profile, wallets, savings and transactions, and cannot update balances through the browser Data API. A social subject and database subject are separate identities even if they share an email.
6. Test protected deep links while signed out, cancellation, reload persistence, expired sessions and logout. No Google login should be offered.

## Automated verification

Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, and `npm run test:e2e`. Auth0/provider responses are mocked in browser tests; server tests verify real locally signed JWTs. PGlite tests execute the migrations and enforce grants/RLS for two opaque string subjects. `npx tsx scripts/check-integrations.ts` performs read-only live connectivity checks.
