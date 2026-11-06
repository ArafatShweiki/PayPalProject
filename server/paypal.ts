import { ServiceError } from "./reliability.js";
export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
export const paypalEnabled = () =>
  !!(
    process.env.PAYPAL_CLIENT_ID?.trim() &&
    process.env.PAYPAL_CLIENT_SECRET?.trim()
  );
async function providerFetch(url: string, options: RequestInit) {
  try {
    return await fetch(url, options);
  } catch {
    // Never log credentials, OAuth tokens or provider response bodies.
    if (process.env.NODE_ENV !== "production")
      console.warn(
        JSON.stringify({ event: "paypal_sandbox_network_unavailable" }),
      );
    throw new ServiceError(
      "PayPal Sandbox took too long or could not be reached. Check payment status before retrying.",
      503,
    );
  }
}
export async function paypal(
  path: string,
  body: unknown,
  key: string,
  method = "POST",
) {
  if (!paypalEnabled()) throw new Error("PayPal Sandbox is not configured.");
  const tokenResponse = await providerFetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenResponse.ok) {
    if (process.env.NODE_ENV !== "production")
      console.warn(
        JSON.stringify({
          event: "paypal_sandbox_authentication_failed",
          status: tokenResponse.status,
        }),
      );
    throw new ServiceError("PayPal Sandbox authentication unavailable.", 503);
  }
  const token = await tokenResponse.json();
  if (typeof token.access_token !== "string" || !token.access_token)
    throw new ServiceError("PayPal Sandbox authentication unavailable.", 503);
  const res = await providerFetch(`${PAYPAL_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": key,
      Prefer: "return=representation",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const failure = await res.json().catch(() => ({}));
    // Match known codes only; never return arbitrary provider text or account details.
    const issues = Array.isArray(failure?.details)
      ? failure.details.map((detail: { issue?: unknown }) => detail?.issue)
      : [];
    if (issues.includes("CURRENCY_NOT_SUPPORTED"))
      throw new ServiceError(
        "PayPal could not accept the selected currency for this payment. The receiving PayPal Business account may need its currency receiving preferences updated. No alternative currency was selected.",
        422,
      );
    if (
      issues.includes("PAYEE_ACCOUNT_RESTRICTED") ||
      issues.includes("PAYEE_ACCOUNT_NOT_VERIFIED")
    )
      throw new ServiceError(
        "The receiving PayPal Business account cannot accept this payment. Ask the app administrator to check the merchant account settings.",
        422,
      );
    throw new ServiceError(
      "PayPal Sandbox request could not be completed. Retry using the same order.",
      503,
    );
  }
  return res.json();
}
