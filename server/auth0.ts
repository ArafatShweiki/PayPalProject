import "./env";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHash } from "node:crypto";

export const auth0Enabled = process.env.AUTH0_ENABLED === "true";
const domain = process.env.AUTH0_DOMAIN || "";
const clientId = process.env.AUTH0_CLIENT_ID || "";
if (auth0Enabled && (!/^[a-zA-Z0-9.-]+$/.test(domain) || !clientId))
  throw new Error("Auth0 requires a valid AUTH0_DOMAIN and AUTH0_CLIENT_ID.");
export const auth0Config = auth0Enabled
  ? {
      domain,
      clientId,
      databaseConnection:
        process.env.AUTH0_DATABASE_CONNECTION ||
        "Username-Password-Authentication",
    }
  : null;
const issuer = `https://${domain}/`;
const jwks = auth0Enabled
  ? createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`))
  : undefined;
async function verifiedClaims(token: string) {
  if (!jwks) throw new Error("Auth0 is not configured.");
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (
    !payload.sub ||
    (payload.azp !== undefined && payload.azp !== clientId) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== clientId) ||
    (process.env.SUPABASE_ENABLED === "true" &&
      payload.role !== "authenticated")
  )
    throw new Error("Invalid wallet token.");
  return payload;
}

// The existing first-party server consumes the same app-bound ID token as
// Supabase. Validate its client-ID audience, never an invented API audience.
export async function verifyWalletIdentity(token: string) {
  const payload = await verifiedClaims(token);
  // Namespace identities and hash them for safe SQLite/Firestore keys. Never merge by email.
  return {
    uid: `auth0_${createHash("sha256").update(`${issuer}|${payload.sub}`).digest("hex")}`,
    sub: payload.sub!,
  };
}

export async function verifyWalletToken(token: string) {
  return (await verifyWalletIdentity(token)).uid;
}
export async function auth0UserInfo(token: string, sub: string) {
  // ID tokens must not be sent to /userinfo (which expects access tokens).
  const info = await verifiedClaims(token);
  if (info.sub !== sub) throw new Error("Identity could not be verified.");
  return {
    name: typeof info.name === "string" ? info.name : "",
    email: typeof info.email === "string" ? info.email : "",
    emailVerified: info.email_verified === true,
  };
}
