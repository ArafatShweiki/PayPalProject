export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
export const paypalEnabled = () =>
  !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
export async function paypal(
  path: string,
  body: unknown,
  key: string,
  method = "POST",
) {
  if (!paypalEnabled()) throw new Error("PayPal Sandbox is not configured.");
  const tokenResponse = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenResponse.ok)
    throw new Error("PayPal Sandbox authentication unavailable.");
  const token = await tokenResponse.json();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": key,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok)
    throw new Error(
      "PayPal Sandbox request could not be completed. Retry using the same order.",
    );
  return res.json();
}
export function verifyCapture(
  body: {
    id?: string;
    status?: string;
    purchase_units?: {
      payments?: {
        captures?: {
          id?: string;
          status?: string;
          amount?: { currency_code?: string; value?: string };
        }[];
      };
    }[];
  },
  id: string,
) {
  if (body.id !== id) throw new Error("PayPal order mismatch.");
  const captures =
    body.purchase_units?.flatMap((p) => p.payments?.captures ?? []) ?? [];
  const capture = captures[0];
  if (
    captures.length !== 1 ||
    !capture.id ||
    capture.amount?.currency_code !== "USD" ||
    capture.amount.value !== "1.00"
  )
    throw new Error("PayPal capture amount mismatch.");
  return {
    status:
      body.status === "COMPLETED" && capture.status === "COMPLETED"
        ? "COMPLETED"
        : capture.status === "PENDING"
          ? "PENDING"
          : "FAILED",
    captureId: capture.id,
  };
}
