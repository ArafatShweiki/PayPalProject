import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { z } from "zod";
import {
  PRODUCTION_ORIGIN,
  origin,
  previewTarget,
  assertRequest,
  type Target,
} from "./safety";

// Deliberately do not load application/production .env files into live tests.
if (existsSync(".env.live.local")) {
  for (const [key, value] of Object.entries(
    parse(readFileSync(".env.live.local")),
  ))
    if (key.startsWith("LIVE_") && process.env[key] === undefined)
      process.env[key] = value;
}
const configSchema = z
  .object({
    marketProvider: z.enum(["PMA", "Twelve Data"]),
    auth0: z
      .object({
        domain: z.string().regex(/^[a-z0-9.-]+$/i),
        clientId: z.string().min(1),
        databaseConnection: z.string(),
      })
      .strict()
      .nullable(),
    supabase: z
      .object({ url: z.url(), publishableKey: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type PublicConfig = z.infer<typeof configSchema>;
export function publicConfig(value: unknown) {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Public configuration failed the allowed-field/schema check; response values withheld.",
    );
  const key = parsed.data.supabase?.publishableKey || "";
  let role = "";
  try {
    role = JSON.parse(
      Buffer.from(key.split(".")[1] || "", "base64url").toString(),
    ).role;
  } catch {
    /* opaque public key */
  }
  if (key.startsWith("sb_secret_") || role === "service_role")
    throw new Error(
      "Public configuration exposes a privileged credential; value withheld.",
    );
  return parsed.data;
}
export type SafeResponse<T> = {
  status: number;
  headers: Headers;
  body: T;
  rejectionLayer?: "vercel-firewall";
};
export async function safeSend<T = unknown>(
  target: Target,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<SafeResponse<T>> {
  const url = new URL(path, target.origin).href;
  const authorization = token ? `Bearer ${token}` : "";
  assertRequest(target, method, url, authorization);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "X-WalletWise": "1",
              Origin: target.origin,
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(
      "Live request failed or timed out; credentials and response values withheld.",
    );
  }
  if (response.status >= 300 && response.status < 400)
    throw new Error(
      "Live API request unexpectedly redirected; redirect not followed.",
    );
  const text = await response.text();
  if (/FUNCTION_INVOCATION_FAILED|ERR_MODULE_NOT_FOUND/.test(text))
    throw new Error(
      "Live Vercel function failed to initialize (including ESM regression).",
    );
  // The Firewall dashboard confirmed DDoS Mitigation for these Node probes.
  // This exception applies only to the two intentionally invalid production
  // tokens, not to normal API errors, Preview, or application authentication.
  if (
    target.mode === "production-smoke" &&
    target.origin === PRODUCTION_ORIGIN &&
    method === "GET" &&
    url === `${PRODUCTION_ORIGIN}/api/state` &&
    ["live-smoke-invalid", "eyJhbGciOiJub25lIn0.eyJleHAiOjF9."].includes(
      token || "",
    ) &&
    response.status === 403 &&
    response.headers.get("server")?.toLowerCase() === "vercel" &&
    !!response.headers.get("x-vercel-id") &&
    !response.headers.has("x-request-id") &&
    response.headers.get("content-type")?.split(";")[0].trim() ===
      "text/plain" &&
    /^Forbidden(?:\r?\n)+Forbidden(?:\r?\n)+[A-Za-z0-9:._=-]+\s*$/.test(text)
  )
    return {
      status: 403,
      headers: response.headers,
      body: null as T,
      rejectionLayer: "vercel-firewall",
    };
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Live API returned a non-JSON response (HTTP ${response.status}; app request ID ${response.headers.has("x-request-id") ? "present" : "absent"}; Vercel ID ${response.headers.has("x-vercel-id") ? "present" : "absent"}); body withheld.`,
    );
  }
  return {
    status: response.status,
    headers: response.headers,
    body: result as T,
  };
}
export const production: Target = {
  mode: "production-smoke",
  origin: PRODUCTION_ORIGIN,
};
export const previewVariables = [
  "LIVE_PREVIEW_ORIGIN",
  "LIVE_SUPABASE_TEST_URL",
  "LIVE_SUPABASE_TEST_PROJECT",
  "LIVE_SUPABASE_TEST_SECRET_KEY",
  "LIVE_AUTH0_TEST_DOMAIN",
  "LIVE_AUTH0_TEST_CLIENT_ID",
  "LIVE_USER_A_EMAIL",
  "LIVE_USER_A_PASSWORD",
  "LIVE_USER_A_SUB",
  "LIVE_USER_B_EMAIL",
  "LIVE_USER_B_PASSWORD",
  "LIVE_USER_B_SUB",
  "LIVE_ACCOUNTS_AUTHORIZED",
] as const;
export function missingPreview() {
  return previewVariables.filter((key) => !process.env[key]);
}
export async function validatePreview(): Promise<{
  target: Target;
  config: PublicConfig;
}> {
  if (missingPreview().length)
    throw new Error(
      `BLOCKED: missing dedicated Preview configuration: ${missingPreview().join(", ")}`,
    );
  if (process.env.LIVE_ACCOUNTS_AUTHORIZED !== "true")
    throw new Error(
      "BLOCKED: dedicated test-account authorization is required.",
    );
  const app = origin(process.env.LIVE_PREVIEW_ORIGIN!);
  if (app === PRODUCTION_ORIGIN)
    throw new Error("LIVE SAFETY GUARD: Preview cannot point at Production.");
  const prod = await safeSend(production, "GET", "/api/config");
  const prodConfig = publicConfig(prod.body);
  if (prod.status !== 200 || !prodConfig.supabase)
    throw new Error(
      "Cannot verify Production database identity; Preview mutations are blocked.",
    );
  // A candidate may make a config GET only, before database isolation is proven.
  const candidate: Target = { mode: "preview-e2e", origin: app };
  const preview = await safeSend(candidate, "GET", "/api/config");
  const config = publicConfig(preview.body);
  if (preview.status !== 200 || !config.supabase || !config.auth0)
    throw new Error("Preview health/configuration check failed.");
  const target = previewTarget(
    app,
    config.supabase.url,
    prodConfig.supabase.url,
    process.env.LIVE_SUPABASE_TEST_PROJECT!,
  );
  if (
    origin(process.env.LIVE_SUPABASE_TEST_URL!) !== target.databaseOrigin ||
    config.auth0.domain !== process.env.LIVE_AUTH0_TEST_DOMAIN ||
    config.auth0.clientId !== process.env.LIVE_AUTH0_TEST_CLIENT_ID
  )
    throw new Error(
      "Preview deployment does not match the explicitly authorized database/Auth0 configuration.",
    );
  if (
    process.env.LIVE_USER_A_SUB === process.env.LIVE_USER_B_SUB ||
    process.env.LIVE_USER_A_EMAIL === process.env.LIVE_USER_B_EMAIL
  )
    throw new Error("Two distinct dedicated accounts are required.");
  target.auth0Origin = `https://${config.auth0.domain}`;
  target.auth0ClientId = config.auth0.clientId;
  // Read-only schema readiness with a test-only key; no application .env fallback.
  let schema: Response;
  try {
    schema = await fetch(`${target.databaseOrigin}/rest/v1/`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: process.env.LIVE_SUPABASE_TEST_SECRET_KEY!,
        Authorization: `Bearer ${process.env.LIVE_SUPABASE_TEST_SECRET_KEY!}`,
      },
    });
  } catch {
    throw new Error(
      "Test database schema could not be checked; mutations blocked.",
    );
  }
  if (!schema.ok)
    throw new Error(
      "Test database key/schema verification failed; mutations blocked.",
    );
  const paths = (await schema.json()).paths ?? {};
  const required = [
    "/rpc/walletwise_backend_read",
    "/rpc/walletwise_consume_limit",
    "/rpc/walletwise_backend_lease",
    "/rpc/walletwise_join_circle",
    "/rpc/walletwise_goal_purchase",
    "/rpc/walletwise_circle_command",
    "/rpc/walletwise_funding_credit",
    "/wallets",
    "/transactions",
    "/ledger_entries",
    "/circle_votes",
  ];
  if (required.some((path) => !paths[path]))
    throw new Error(
      "Test database migrations/RPC visibility are incomplete; mutations blocked.",
    );
  target.mutationReady = true;
  return { target, config };
}
