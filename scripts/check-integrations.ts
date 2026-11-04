import "../server/env";
import { createClient } from "@supabase/supabase-js";

// Read-only diagnostics. Never print credentials, response bodies or user rows.
const tables = [
  "profiles",
  "wallets",
  "transactions",
  "ledger_entries",
  "savings_rules",
  "savings_goals",
  "savings_allocations",
  "exchange_rates",
  "currency_alerts",
  "notifications",
  "ai_reports",
  "account_state",
  "funding_orders",
];
const url = process.env.SUPABASE_URL;
const publishable =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const secret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
  },
};
if (url && publishable && secret) {
  const backend = createClient(url, secret, options);
  const anonymous = createClient(url, publishable, options);
  for (const table of tables) {
    const result = await backend.from(table).select("*").limit(0);
    console.log(
      JSON.stringify({
        check: `backend:${table}`,
        status: result.status,
        code: result.error?.code || null,
        pass: !result.error,
      }),
    );
    if (result.error) process.exitCode = 1;
    const denied = await anonymous.from(table).select("*").limit(1);
    console.log(
      JSON.stringify({
        check: `anonymous:${table}`,
        status: denied.status,
        code: denied.error?.code || null,
        blocked: !!denied.error,
        pass:
          !result.error &&
          !!denied.error &&
          ([401, 403].includes(denied.status) ||
            (denied.status === 404 && denied.error.code === "PGRST205")),
      }),
    );
  }
  const result = await backend
    .from("profiles")
    .select("wallet_preferences")
    .limit(0);
  console.log(
    JSON.stringify({
      check: "wallet-preferences-migration",
      status: result.status,
      code: result.error?.code || null,
      pass: !result.error,
    }),
  );
  if (result.error) process.exitCode = 1;
  const forged = createClient(url, publishable, {
    ...options,
    accessToken: async () => "forged.invalid.token",
  });
  const denied = await forged.from("profiles").select("auth0_sub").limit(1);
  console.log(
    JSON.stringify({
      check: "forged-token",
      status: denied.status,
      pass: !!denied.error && [401, 403].includes(denied.status),
    }),
  );
} else
  console.log(
    "Supabase connectivity BLOCKED: required environment variables missing.",
  );
if (process.env.AUTH0_DOMAIN) {
  try {
    const issuer = `https://${process.env.AUTH0_DOMAIN}/`;
    const response = await fetch(`${issuer}.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10000),
    });
    const config = await response.json();
    const keys = await fetch(config.jwks_uri, {
      signal: AbortSignal.timeout(10000),
    });
    const jwks = await keys.json();
    console.log(
      JSON.stringify({
        check: "auth0-discovery-jwks",
        pass:
          response.ok &&
          keys.ok &&
          config.issuer === issuer &&
          jwks.keys?.some(
            (key: { kty: string; kid: string }) =>
              key.kty === "RSA" && !!key.kid,
          ),
      }),
    );
  } catch {
    console.log("Auth0 discovery/JWKS FAIL: request unavailable.");
  }
}
