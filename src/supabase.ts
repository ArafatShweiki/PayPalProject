import { isDemoActive } from "./demoSession";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type BrowserSupabaseConfig = { url: string; publishableKey: string };
let configuration: BrowserSupabaseConfig | null = null;
let tokenProvider: (() => Promise<string>) | undefined;
let client: SupabaseClient | undefined;

export function configureSupabase(config: BrowserSupabaseConfig | null) {
  configuration = config;
  client = undefined;
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
  if (isDemoActive() || !configuration) return null;
  return (client ??= createClient(
    configuration.url,
    configuration.publishableKey,
    {
      accessToken: async () => {
        if (isDemoActive())
          throw new Error("Supabase is disabled in Developer Demo Mode.");
        if (!tokenProvider) throw new Error("Auth0 ID token is not available.");
        return tokenProvider();
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  ));
}
