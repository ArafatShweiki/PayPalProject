import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { FundingOrder } from "../shared/types";
import { ServiceError } from "../server/reliability";
const state = vi.hoisted(() => ({
  rows: new Map<string, FundingOrder>(),
  credits: vi.fn(),
  captureCalls: 0,
  phase: "APPROVED",
  badAmount: false,
  failSave: false,
  providerTimeout: false,
  lostCaptureResponse: false,
  rejectCurrency: "",
  rejectAtCapture: false,
  createdCurrency: "",
  badCurrency: false,
  keys: [] as string[],
}));
vi.mock("../server/supabase", () => ({
  getServerSupabase: () => ({
    rpc: async (name: string, p: Record<string, unknown>) => {
      if (name === "walletwise_funding_reserve") {
        const prior = [...state.rows.values()].find(
          (o) => o.auth0_sub === p.p_sub && o.request_id === p.p_key,
        );
        if (prior) return { data: prior };
        const row = {
          id: randomUUID(),
          auth0_sub: String(p.p_sub),
          request_id: String(p.p_key),
          fingerprint: String(p.p_fingerprint),
          amount_minor: Number(p.p_amount),
          currency: p.p_currency as "USD",
          status: "CREATING",
          created_at: new Date().toISOString(),
        };
        state.rows.set(row.id, row);
        return { data: row };
      }
      const row = state.rows.get(String(p.p_id))!;
      if (name === "walletwise_funding_status") {
        row.status = String(p.p_status);
        if (p.p_order) row.provider_order_id = String(p.p_order);
        if (p.p_url) row.approval_url = String(p.p_url);
        return { data: row };
      }
      if (name === "walletwise_funding_credit") {
        if (state.failSave) return { error: { message: "storage failed" } };
        if (!row.transaction_id) {
          row.transaction_id = randomUUID();
          row.capture_id = String(p.p_capture);
          row.status = "COMPLETED";
          state.credits(row);
        }
        return { data: row };
      }
      if (name === "walletwise_funding_reverse") {
        row.status = "REVERSED";
        row.reversal_id ??= randomUUID();
      }
      if (name === "walletwise_funding_review") row.status = "REFUND_REVIEW";
      return { data: row };
    },
    from: () => {
      const filters: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: string) => {
          filters[k] = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({
          data: [...state.rows.values()].find((o) =>
            Object.entries(filters).every(
              ([k, v]) => o[k as keyof FundingOrder] === v,
            ),
          ),
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: [...state.rows.values()].filter((o) =>
              Object.entries(filters).every(
                ([k, v]) => o[k as keyof FundingOrder] === v,
              ),
            ),
          }).then(resolve),
      };
      return q;
    },
  }),
}));
vi.mock("../server/paypal", () => ({
  paypalEnabled: () => true,
  paypal: async (path: string, body: unknown, key: string) => {
    if (state.providerTimeout)
      throw new DOMException("Provider timed out", "TimeoutError");
    state.keys.push(key);
    if (path === "/v2/checkout/orders") {
      state.createdCurrency = (
        body as { purchase_units: { amount: { currency_code: string } }[] }
      ).purchase_units[0].amount.currency_code;
      if (
        state.rejectCurrency === state.createdCurrency &&
        !state.rejectAtCapture
      )
        throw new ServiceError(
          "PayPal could not accept the selected currency for this payment.",
          422,
        );
      return {
        id: "ORDER123",
        links: [
          {
            rel: "payer-action",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123",
          },
        ],
      };
    }
    const row = [...state.rows.values()].find(
      (o) => o.provider_order_id === "ORDER123",
    )!;
    if (path.startsWith("/v2/payments/captures/"))
      return {
        id: "CAPTURE123",
        status: state.phase,
        amount: {
          currency_code: row.currency,
          value: state.badAmount ? "49.00" : "50.00",
        },
      };
    if (path.endsWith("/capture")) {
      if (state.rejectAtCapture && state.rejectCurrency === row.currency)
        throw new ServiceError(
          "PayPal could not accept the selected currency for this payment.",
          422,
        );
      state.captureCalls++;
      state.phase = "COMPLETED";
      if (state.lostCaptureResponse)
        throw new DOMException("Capture response lost", "TimeoutError");
    }
    return {
      id: "ORDER123",
      intent: "CAPTURE",
      status: state.phase,
      purchase_units: [
        {
          custom_id: row.id,
          invoice_id: row.id,
          payee: { merchant_id: "MERCHANT" },
          amount: { currency_code: row.currency, value: "50.00" },
          payments: [
            "COMPLETED",
            "PENDING",
            "REFUNDED",
            "PARTIALLY_REFUNDED",
          ].includes(state.phase)
            ? {
                captures: [
                  {
                    id: "CAPTURE123",
                    status: state.phase,
                    final_capture: true,
                    amount: {
                      currency_code: state.badCurrency
                        ? row.currency === "USD"
                          ? "ILS"
                          : "USD"
                        : row.currency,
                      value: state.badAmount ? "49.00" : "50.00",
                    },
                  },
                ],
              }
            : undefined,
        },
      ],
    };
  },
}));
import { fundingRouter } from "../server/funding";
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const sub = req.headers.authorization?.replace("Bearer ", "");
    if (sub) {
      res.locals.sub = sub;
      res.locals.uid = sub;
    }
    next();
  });
  app.use(fundingRouter);
  app.use(
    (
      e: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status((e as Error & { status?: number }).status || 400)
        .json({ error: e.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  vi.unstubAllEnvs();
});
beforeEach(() => {
  state.rows.clear();
  state.credits.mockClear();
  state.captureCalls = 0;
  state.phase = "APPROVED";
  state.badAmount = false;
  state.failSave = false;
  state.providerTimeout = false;
  state.lostCaptureResponse = false;
  state.rejectCurrency = "";
  state.rejectAtCapture = false;
  state.createdCurrency = "";
  state.badCurrency = false;
  state.keys = [];
  vi.stubEnv("PAYPAL_MERCHANT_ID", "MERCHANT");
  vi.stubEnv("PAYPAL_FUNDING_CURRENCIES", "USD,ILS");
  vi.stubEnv("RATE_LIMIT_FUNDING", "1000");
});
async function call(path: string, body?: unknown, user = "auth0|alice") {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(user ? { authorization: `Bearer ${user}` } : {}),
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
const create = (currency = "USD") =>
  call("/orders", {
    requestId: randomUUID(),
    currency,
    amount: "50.00",
  });
it("requires verified context and rejects unsupported currencies and precision", async () => {
  expect((await call("/", undefined, "")).status).toBe(401);
  expect(
    (
      await call("/orders", {
        requestId: randomUUID(),
        currency: "JOD",
        amount: "1.000",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call("/orders", {
        requestId: randomUUID(),
        currency: "USD",
        amount: "1.001",
      })
    ).status,
  ).toBe(400);
});
it.each(["USD", "ILS"])(
  "creates, verifies and credits a %s order in its selected currency only",
  async (currency) => {
    const o = (await create(currency)).data;
    expect(state.createdCurrency).toBe(currency);
    expect(o.currency).toBe(currency);
    expect((await call(`/${o.id}/capture`, {})).data.status).toBe("COMPLETED");
    expect(state.credits).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ currency, amount_minor: 5000 }),
    );
    await call(`/${o.id}/capture`, {});
    expect(state.credits).toHaveBeenCalledOnce();
  },
);
it.each(["USD", "ILS"])(
  "does not substitute a currency or credit when the merchant rejects %s creation or capture",
  async (currency) => {
    state.rejectCurrency = currency;
    expect((await create(currency)).status).toBe(422);
    expect(state.createdCurrency).toBe(currency);
    expect(state.credits).not.toHaveBeenCalled();
    state.rows.clear();
    state.rejectAtCapture = true;
    const o = (await create(currency)).data;
    expect((await call(`/${o.id}/capture`, {})).status).toBe(422);
    expect(state.credits).not.toHaveBeenCalled();
  },
);
it.each(["USD", "ILS"])(
  "does not credit %s for pending, failed, canceled or mismatched-currency captures",
  async (currency) => {
    const o = (await create(currency)).data;
    state.phase = "PENDING";
    await call(`/${o.id}/capture`, {});
    state.phase = "VOIDED";
    await call(`/${o.id}/capture`, {});
    await call(`/${o.id}/cancel`, {});
    state.phase = "COMPLETED";
    state.badCurrency = true;
    expect((await call(`/${o.id}/capture`, {})).status).toBe(502);
    expect(state.credits).not.toHaveBeenCalled();
  },
);
it("does not offer funding without merchant configuration", async () => {
  vi.stubEnv("PAYPAL_MERCHANT_ID", "");
  expect((await create()).status).toBe(503);
  expect(state.rows.size).toBe(0);
  const config = (await call("/")).data;
  expect(config.available).toBe(false);
  expect(config.clientId).toBeUndefined();
  expect(config.unavailableReason).toContain("not configured");
});
it("returns only the public Checkout client ID and never the client secret", async () => {
  vi.stubEnv("PAYPAL_CLIENT_ID", "public-checkout-id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "private-checkout-secret");
  const result = await call("/");
  expect(result.data.clientId).toBe("public-checkout-id");
  expect(JSON.stringify(result.data)).not.toContain("private-checkout-secret");
});
it("retains the order and never credits when the provider times out, then recovers safely", async () => {
  const o = (await create()).data;
  state.providerTimeout = true;
  await call(`/${o.id}/capture`, {});
  expect(state.captureCalls).toBe(0);
  expect(state.credits).not.toHaveBeenCalled();
  expect(state.rows.get(o.id)?.provider_order_id).toBe("ORDER123");
  state.providerTimeout = false;
  state.lostCaptureResponse = true;
  expect((await call(`/${o.id}/capture`, {})).data.status).toBe("COMPLETED");
  expect(state.captureCalls).toBe(1);
  expect(state.credits).toHaveBeenCalledOnce();
});
it("captures and verifies before crediting and preserves a stable capture idempotency key", async () => {
  const o = (await create()).data;
  const first = await call(`/${o.id}/capture`, {});
  expect(first.data.status).toBe("COMPLETED");
  expect(state.credits).toHaveBeenCalledOnce();
  expect(state.keys[0]).toHaveLength(36);
  expect(state.keys[2]).toHaveLength(36);
  expect(state.keys[2]).not.toBe(state.keys[0]);
  expect(state.captureCalls).toBe(1);
  expect((await call(`/${o.id}/capture`, {})).data.status).toBe("COMPLETED");
  expect(state.captureCalls).toBe(1);
  expect(state.credits).toHaveBeenCalledOnce();
});
it("does not credit pending, failed, or canceled payments", async () => {
  const o = (await create()).data;
  state.phase = "PENDING";
  expect((await call(`/${o.id}/capture`, {})).data.status).toBe("PENDING");
  expect(state.credits).not.toHaveBeenCalled();
  state.phase = "VOIDED";
  await call(`/${o.id}/cancel`, {});
  expect(state.credits).not.toHaveBeenCalled();
  expect(state.captureCalls).toBe(0);
});
it("rejects another account and never accepts a frontend reported capture", async () => {
  const o = (await create()).data;
  expect((await call(`/${o.id}/capture`, {}, "auth0|bob")).status).toBe(404);
  expect(state.captureCalls).toBe(0);
  state.phase = "COMPLETED";
  state.badAmount = true;
  expect(
    (
      await call(`/${o.id}/capture`, {
        amount: "50.00",
        captureId: "FAKE",
        status: "COMPLETED",
      })
    ).status,
  ).toBe(502);
  expect(state.credits).not.toHaveBeenCalled();
});
it("recovers after capture success and database failure without capturing again", async () => {
  const o = (await create()).data;
  state.failSave = true;
  await call(`/${o.id}/capture`, {});
  expect(state.captureCalls).toBe(1);
  expect(state.credits).not.toHaveBeenCalled();
  state.failSave = false;
  await call(`/${o.id}/reconcile`, {});
  expect(state.captureCalls).toBe(1);
  expect(state.credits).toHaveBeenCalledOnce();
});
it("checks the verified capture for full refunds and flags partial refunds for review", async () => {
  const o = (await create()).data;
  await call(`/${o.id}/capture`, {});
  state.phase = "PARTIALLY_REFUNDED";
  expect((await call(`/${o.id}/reconcile`, {})).data.status).toBe(
    "REFUND_REVIEW",
  );
  state.phase = "REFUNDED";
  const reversed = await call(`/${o.id}/reconcile`, {});
  expect(reversed.data.status).toBe("REVERSED");
  expect((await call(`/${o.id}/reconcile`, {})).data.reversal_id).toBe(
    reversed.data.reversal_id,
  );
  expect(state.captureCalls).toBe(1);
  expect(state.credits).toHaveBeenCalledOnce();
});
