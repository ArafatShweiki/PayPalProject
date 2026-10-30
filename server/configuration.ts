export function validateSupabaseConfiguration(env: NodeJS.ProcessEnv) {
  if (env.SUPABASE_ENABLED !== "true") return;
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    env.AUTH0_ENABLED !== "true" ||
    !env.SUPABASE_URL ||
    !publicKey ||
    !secret
  )
    throw new Error(
      "Supabase requires Auth0 enabled, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and a server-only SUPABASE_SECRET_KEY.",
    );
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new Error("SUPABASE_URL must be a valid project URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "SUPABASE_URL must use HTTPS, or HTTP for local development, without credentials or query parameters.",
    );
  let legacyRole: unknown;
  try {
    legacyRole = JSON.parse(
      Buffer.from(publicKey.split(".")[1] || "", "base64url").toString(),
    ).role;
  } catch {
    /* New publishable keys are opaque. */
  }
  if (
    publicKey === secret ||
    publicKey.startsWith("sb_secret_") ||
    legacyRole === "service_role"
  )
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY contains a server secret. Use only the project's publishable or legacy anon key.",
    );
}
