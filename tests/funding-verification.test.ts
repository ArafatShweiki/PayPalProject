import { afterEach, it, expect, vi } from "vitest";
import { verifyFunding } from "../server/funding";
import type { FundingOrder } from "../shared/types";
afterEach(() => vi.unstubAllEnvs());
const order: FundingOrder = {
  id: "funding",
  auth0_sub: "auth0|a",
  currency: "USD",
  amount_minor: 5000,
  request_id: "key",
  fingerprint: "fp",
  status: "CREATED",
  provider_order_id: "ORDER",
  created_at: new Date().toISOString(),
};
const receipt = () => ({
  id: "ORDER",
  intent: "CAPTURE",
  status: "COMPLETED",
  purchase_units: [
    {
      custom_id: "funding",
      invoice_id: "funding",
      payee: { merchant_id: "MERCHANT" },
      amount: { currency_code: "USD", value: "50.00" },
      payments: {
        captures: [
          {
            id: "CAPTURE",
            status: "COMPLETED",
            final_capture: true,
            amount: { currency_code: "USD", value: "50.00" },
          },
        ],
      },
    },
  ],
});
it("accepts only the exact completed order and capture and preserves supported currency precision", () => {
  vi.stubEnv("PAYPAL_MERCHANT_ID", "MERCHANT");
  expect(verifyFunding(receipt(), order)).toEqual({
    status: "COMPLETED",
    captureId: "CAPTURE",
  });
  const ils = receipt();
  ils.purchase_units[0].amount.currency_code = "ILS";
  ils.purchase_units[0].payments.captures[0].amount.currency_code = "ILS";
  expect(verifyFunding(ils, { ...order, currency: "ILS" }).status).toBe(
    "COMPLETED",
  );
});
it.each([
  "merchant",
  "invoice",
  "owner binding",
  "amount",
  "currency",
  "order",
  "capture amount",
  "partial capture",
  "duplicate capture",
])("rejects a mismatched %s", (kind) => {
  vi.stubEnv("PAYPAL_MERCHANT_ID", "MERCHANT");
  const body = receipt(),
    u = body.purchase_units[0];
  if (kind === "merchant") u.payee.merchant_id = "OTHER";
  if (kind === "invoice") u.invoice_id = "OTHER";
  if (kind === "owner binding") u.custom_id = "OTHER";
  if (kind === "amount") u.amount.value = "49.99";
  if (kind === "currency") u.amount.currency_code = "ILS";
  if (kind === "order") body.id = "OTHER";
  if (kind === "capture amount") u.payments.captures[0].amount.value = "49.99";
  if (kind === "partial capture") u.payments.captures[0].final_capture = false;
  if (kind === "duplicate capture")
    u.payments.captures.push({ ...u.payments.captures[0], id: "ANOTHER" });
  expect(() => verifyFunding(body, order)).toThrow();
});
it("does not treat pending or failed captures as completed", () => {
  vi.stubEnv("PAYPAL_MERCHANT_ID", "MERCHANT");
  for (const status of ["PENDING", "DECLINED", "FAILED"]) {
    const body = receipt();
    body.purchase_units[0].payments.captures[0].status = status;
    expect(verifyFunding(body, order).status).not.toBe("COMPLETED");
  }
});
