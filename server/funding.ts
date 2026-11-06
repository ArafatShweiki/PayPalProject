import { Router } from "express";
import { applicationOrigin } from "./configuration.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { paypal, paypalEnabled } from "./paypal.js";
import { getServerSupabase } from "./supabase.js";
import { databaseError } from "./database-errors.js";
import { limitMiddleware, ServiceError } from "./reliability.js";
import { minor, decimal } from "../shared/money.js";
import type { FundingOrder } from "../shared/types.js";

export const fundingCurrencies = () =>
  [
    ...new Set(
      (process.env.PAYPAL_FUNDING_CURRENCIES || "USD")
        .split(",")
        .map((c) => c.trim()),
    ),
  ].filter((c) => c === "USD" || c === "ILS") as ("USD" | "ILS")[];
export const fundingEnabled = () =>
  paypalEnabled() &&
  !!process.env.PAYPAL_MERCHANT_ID?.trim() &&
  fundingCurrencies().length > 0;
export function fundingConfiguration() {
  const missing = [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
  ].filter((name) => !process.env[name]?.trim());
  if (!fundingCurrencies().length) missing.push("PAYPAL_FUNDING_CURRENCIES");
  return { available: fundingEnabled(), missing };
}
let lastConfigurationWarning = "";
export function diagnoseFundingConfiguration() {
  const { missing } = fundingConfiguration();
  const signature = missing.join(",");
  if (
    process.env.NODE_ENV !== "production" &&
    signature &&
    signature !== lastConfigurationWarning
  )
    console.warn(
      JSON.stringify({ event: "paypal_funding_unavailable", missing }),
    );
  lastConfigurationWarning = signature;
}
export const fundingLimit = () =>
  Math.min(
    10000000,
    Math.max(100, Number(process.env.FUNDING_MAX_MINOR) || 500000),
  );
export const fundingRequestKey = (kind: string, id: string) =>
  createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0, 36);
async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<FundingOrder> {
  const { data, error } = await getServerSupabase().rpc(name, args);
  if (error) throw databaseError(error);
  return data as FundingOrder;
}
async function owned(sub: string, id: string): Promise<FundingOrder> {
  const { data, error } = await getServerSupabase()
    .from("funding_orders")
    .select("*")
    .eq("auth0_sub", sub)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!data) throw new ServiceError("Payment not found for your account.", 404);
  return data as FundingOrder;
}
const setStatus = (
  o: FundingOrder,
  status: string,
  providerOrder?: string,
  url?: string,
) =>
  rpc("walletwise_funding_status", {
    p_sub: o.auth0_sub,
    p_id: o.id,
    p_status: status,
    p_order: providerOrder ?? null,
    p_url: url ?? null,
  });
const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  final_capture: z.boolean().optional(),
  amount: z.object({ currency_code: z.string(), value: z.string() }),
});
const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  intent: z.string(),
  purchase_units: z.array(
    z.object({
      custom_id: z.string(),
      invoice_id: z.string(),
      payee: z.object({ merchant_id: z.string() }),
      amount: z.object({ currency_code: z.string(), value: z.string() }),
      payments: z
        .object({ captures: z.array(captureSchema).optional() })
        .optional(),
    }),
  ),
});
const captures = (input: unknown) =>
  orderSchema
    .parse(input)
    .purchase_units.flatMap((p) => p.payments?.captures ?? []);
// Input is an authenticated server-to-server provider response, never a browser result.
export function verifyFunding(input: unknown, o: FundingOrder) {
  const body = orderSchema.parse(input);
  const units = body.purchase_units;
  if (
    body.id !== o.provider_order_id ||
    body.intent !== "CAPTURE" ||
    !Array.isArray(units) ||
    units.length !== 1
  )
    throw new ServiceError("Payment verification failed.", 502);
  const unit = units[0],
    list = captures(body);
  if (
    unit.custom_id !== o.id ||
    unit.invoice_id !== o.id ||
    unit.payee?.merchant_id !== process.env.PAYPAL_MERCHANT_ID ||
    unit.amount?.currency_code !== o.currency ||
    minor(unit.amount?.value ?? "", o.currency) !== Number(o.amount_minor)
  )
    throw new ServiceError("Payment verification failed.", 502);
  if (!list.length)
    return { status: body.status === "VOIDED" ? "FAILED" : "PENDING" };
  if (list.length !== 1)
    throw new ServiceError("Payment verification failed.", 502);
  const capture = list[0];
  if (
    !/^[A-Z0-9]{1,64}$/.test(capture.id) ||
    capture.amount?.currency_code !== o.currency ||
    minor(capture.amount?.value ?? "", o.currency) !== Number(o.amount_minor) ||
    capture.final_capture !== true
  )
    throw new ServiceError("Payment verification failed.", 502);
  return {
    status:
      body.status === "COMPLETED" && capture.status === "COMPLETED"
        ? "COMPLETED"
        : capture.status === "PENDING"
          ? "PENDING"
          : ["REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status)
            ? "RECONCILE"
            : "FAILED",
    captureId: capture.id,
  };
}
export async function reconcileFunding(o: FundingOrder, allowCapture = false) {
  if (!o.provider_order_id)
    throw new ServiceError(
      "This payment needs review before it can be retried.",
      409,
    );
  let captureFailure: unknown;
  let body = await paypal(
    `/v2/checkout/orders/${o.provider_order_id}`,
    undefined,
    fundingRequestKey("read", o.id),
    "GET",
  );
  // Verify order ownership, merchant and value before requesting any capture.
  verifyFunding(body, o);
  if (
    !captures(body).length &&
    allowCapture &&
    body.status === "APPROVED" &&
    !["CANCELED", "FAILED"].includes(o.status)
  ) {
    try {
      await paypal(
        `/v2/checkout/orders/${o.provider_order_id}/capture`,
        {},
        fundingRequestKey("capture", o.id),
      );
    } catch (error) {
      captureFailure = error;
      /* GET recovers a lost capture response. */
    }
    body = await paypal(
      `/v2/checkout/orders/${o.provider_order_id}`,
      undefined,
      fundingRequestKey("read", o.id),
      "GET",
    );
  }
  const verified = verifyFunding(body, o);
  if (
    verified.status !== "COMPLETED" &&
    captureFailure instanceof ServiceError &&
    captureFailure.status === 422
  )
    throw captureFailure;
  if (o.transaction_id) {
    const detail = await paypal(
      `/v2/payments/captures/${o.capture_id}`,
      undefined,
      fundingRequestKey("capture-read", o.id),
      "GET",
    );
    if (
      detail.id !== o.capture_id ||
      detail.amount?.currency_code !== o.currency ||
      minor(detail.amount?.value ?? "", o.currency) !== Number(o.amount_minor)
    )
      throw new ServiceError("Payment verification failed.", 502);
    if (detail.status === "REFUNDED")
      return rpc("walletwise_funding_reverse", {
        p_sub: o.auth0_sub,
        p_id: o.id,
        p_capture: o.capture_id,
      });
    if (["PARTIALLY_REFUNDED", "DECLINED", "FAILED"].includes(detail.status)) {
      // Partial refunds require a reviewed ledger adjustment; freeze spending.
      const { error } = await getServerSupabase().rpc(
        "walletwise_funding_review",
        { p_sub: o.auth0_sub, p_id: o.id },
      );
      if (error) throw databaseError(error);
      return owned(o.auth0_sub, o.id);
    }
    return o;
  }
  if (verified.status === "COMPLETED")
    return rpc("walletwise_funding_credit", {
      p_sub: o.auth0_sub,
      p_id: o.id,
      p_capture: verified.captureId,
      p_currency: o.currency,
      p_amount: Number(o.amount_minor),
    });
  if (o.status === "CANCELED") return o;
  return setStatus(o, verified.status);
}
export const fundingRouter = Router();
fundingRouter.use((_req, res, next) => {
  if (!res.locals.sub || !res.locals.uid) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  next();
});
fundingRouter.use(limitMiddleware("funding", "RATE_LIMIT_FUNDING", 10, true));
fundingRouter.get("/", async (_req, res) => {
  diagnoseFundingConfiguration();
  const { data, error } = await getServerSupabase()
    .from("funding_orders")
    .select("*")
    .eq("auth0_sub", res.locals.sub)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw databaseError(error);
  res.json({
    available: fundingEnabled(),
    clientId: fundingEnabled() ? process.env.PAYPAL_CLIENT_ID : undefined,
    unavailableReason: fundingEnabled()
      ? undefined
      : "PayPal Sandbox Checkout is not configured for this app. Please contact the app administrator.",
    currencies: fundingCurrencies(),
    maxMinor: fundingLimit(),
    orders: data,
  });
});
fundingRouter.post("/orders", async (req, res) => {
  if (!fundingEnabled())
    throw new ServiceError(
      "Adding funds is currently unavailable. Please try again later.",
      503,
    );
  const body = z
    .object({
      requestId: z.uuid(),
      currency: z.enum(["USD", "ILS"]),
      amount: z.string().max(20),
    })
    .strict()
    .parse(req.body);
  const value = minor(body.amount, body.currency);
  if (
    !fundingCurrencies().includes(body.currency) ||
    value < 100 ||
    value > fundingLimit()
  )
    throw new ServiceError(
      "Choose a supported currency and an amount within the funding limits.",
      400,
    );
  const fp = createHash("sha256")
    .update(`${body.currency}:${value}`)
    .digest("hex");
  let o = await rpc("walletwise_funding_reserve", {
    p_sub: res.locals.sub,
    p_key: body.requestId,
    p_fingerprint: fp,
    p_currency: body.currency,
    p_amount: value,
  });
  if (o.provider_order_id) {
    res.json(o);
    return;
  }
  // A late retry must not recreate an uncertain order after PayPal's key expires.
  if (Date.now() - Date.parse(o.created_at) > 5 * 60000)
    throw new ServiceError(
      "This payment needs review before it can be retried.",
      409,
    );
  const origin = applicationOrigin();
  try {
    const result = await paypal(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: o.id,
            invoice_id: o.id,
            payee: { merchant_id: process.env.PAYPAL_MERCHANT_ID },
            description: "Dream Piggy Bank test wallet funding",
            amount: {
              currency_code: o.currency,
              value: decimal(Number(o.amount_minor), o.currency),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: `${origin}/?funding=approved&fundingId=${o.id}`,
              cancel_url: `${origin}/?funding=canceled&fundingId=${o.id}`,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      },
      fundingRequestKey("create", o.id),
    );
    const url = result.links?.find(
      (l: { rel: string; href: string }) =>
        l.rel === "payer-action" || l.rel === "approve",
    )?.href;
    if (!/^[A-Z0-9]{1,64}$/.test(result.id) || typeof url !== "string")
      throw new ServiceError("Payment approval is unavailable.", 502);
    const approval = new URL(url);
    if (
      approval.protocol !== "https:" ||
      approval.hostname !== "www.sandbox.paypal.com" ||
      approval.username ||
      approval.password
    )
      throw new ServiceError("Payment approval is unavailable.", 502);
    o = await setStatus(o, "CREATED", result.id, url);
    res.json(o);
  } catch (error) {
    // The durable request/creation key already exists even if this write fails.
    await setStatus(o, "RECONCILE").catch(() => undefined);
    throw error;
  }
});
const id = z.uuid();
fundingRouter.post("/:id/capture", async (req, res) => {
  const o = await owned(res.locals.sub, id.parse(req.params.id));
  res.json(await reconcileFunding(o, true));
});
fundingRouter.post("/:id/reconcile", async (req, res) =>
  res.json(
    await reconcileFunding(
      await owned(res.locals.sub, id.parse(req.params.id)),
    ),
  ),
);
fundingRouter.post("/:id/cancel", async (req, res) => {
  const o = await owned(res.locals.sub, id.parse(req.params.id));
  // Cancel is a local approval cancellation, not a refund. Recover any capture first.
  const current = o.provider_order_id ? await reconcileFunding(o) : o;
  res.json(
    current.transaction_id ? current : await setStatus(current, "CANCELED"),
  );
});
