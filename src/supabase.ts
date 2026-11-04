import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type BrowserSupabaseConfig = { url: string; publishableKey: string };
let configuration: BrowserSupabaseConfig | null = null;
let tokenProvider: (() => Promise<string>) | undefined;
let client: SupabaseClient | undefined;
export const supabaseConfigured = () => !!configuration;

export function configureSupabase(config: BrowserSupabaseConfig | null) {
  if (
    configuration?.url === config?.url &&
    configuration?.publishableKey === config?.publishableKey
  )
    return;
  configuration = config;
  client = undefined;
}
// Auth0 owns expiry/renewal. Reuse its current ID token and coalesce renewals;
// never ask for a custom API audience or send the opaque access token to SQL.
export function sdkIdTokenProvider(
  getClaims: () => Promise<
    { __raw?: string; role?: unknown; exp?: number; sub?: string } | undefined
  >,
  renew: () => Promise<unknown>,
  requireRole = true,
  expectedSubject?: string,
) {
  let pending: Promise<string> | undefined;
  const provider = auth0IdTokenProvider(async () => {
    let claims = await getClaims();
    if (!claims?.exp || claims.exp * 1000 <= Date.now() + 30000) {
      await renew();
      claims = await getClaims();
    }
    if (expectedSubject && claims?.sub !== expectedSubject)
      throw new Error("Sign-in identity changed. Please sign in again.");
    return claims;
  }, requireRole);
  return () =>
    (pending ??= provider().finally(() => {
      pending = undefined;
    }));
}
export function setSupabaseIdTokenProvider(provider?: () => Promise<string>) {
  tokenProvider = provider;
}
export function auth0IdTokenProvider(
  getClaims: () => Promise<{ __raw?: string; role?: unknown } | undefined>,
  requireAuthenticatedRole = true,
) {
  return async () => {
    const claims = await getClaims();
    if (!claims?.__raw) throw new Error("Auth0 ID token is not available.");
    if (requireAuthenticatedRole && claims.role !== "authenticated")
      throw new Error(
        'Auth0 ID token requires role: "authenticated". Sign in again after deploying the Auth0 Action.',
      );
    return claims.__raw;
  };
}
export function getBrowserSupabase(): SupabaseClient | null {
  if (!configuration) return null;
  return (client ??= createClient(
    configuration.url,
    configuration.publishableKey,
    {
      accessToken: async () => {
        if (!tokenProvider) throw new Error("Auth0 ID token is not available.");
        return tokenProvider();
      },
      db: { retry: false },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  ));
}
