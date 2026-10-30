import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { app } from "../server/app";
import { initialUser } from "../shared/ledger";
vi.mock("../server/store", async (original) => ({
  ...(await original<typeof import("../server/store")>()),
  firebaseEnabled: true,
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("test-user-"))
        throw new Error("Invalid test token");
      return { uid: token };
    },
  }),
}));
import { update } from "../server/store";
import { parsePma } from "../server/rates";
import type { State, Snapshot } from "../shared/types";
let server: Server;
let base: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  base = `http://127.0.0.1:${address.port}/api`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
async function client() {
  const token = `test-user-${randomUUID()}`;
  await update(
    `user_${token}`,
    () => initialUser(true),
    () => undefined,
  );
  return {
    state: () =>
      fetch(`${base}/state`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()) as Promise<State>,
    send: async (path: string, body: unknown, method = "POST") => {
      const r = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-WalletWise": "1",
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    },
  };
}
describe("authorized persistent API", () => {
  it("isolates browser sessions and atomically deduplicates concurrent requests", async () => {
    const a = await client(),
      b = await client();
    await a.send("/preferences", { savings: "enabled" }, "PUT");
    const payload = {
      requestId: randomUUID(),
      currency: "ILS",
      amount: "23.40",
      description: "Coffee",
      category: "Food & drink",
    };
    const results = await Promise.all([
      a.send("/purchases", payload),
      a.send("/purchases", payload),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results[0].data.id).toBe(results[1].data.id);
    expect((await a.state()).balances.ILS).toBe(647500);
    expect((await a.state()).savingsBalances.ILS).toBe(160);
    expect((await b.state()).balances.ILS).toBe(650000);
    expect(
      (
        await b.send("/refunds", {
          id: results[0].data.id,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await a.send("/purchases", { ...payload, amount: "10" })).status,
    ).toBe(400);
    await a.send("/refunds", {
      id: results[0].data.id,
      requestId: randomUUID(),
    });
    await a.send("/refunds", {
      id: results[0].data.id,
      requestId: randomUUID(),
    });
    expect((await a.state()).balances.ILS).toBe(650000);
  });
  it("persists goal allocation, opt-out, recommendations and notification preferences", async () => {
    const c = await client();
    await c.send(
      "/preferences",
      { savings: "disabled", notifications: false },
      "PUT",
    );
    await c.send("/purchases", {
      requestId: randomUUID(),
      currency: "ILS",
      amount: "23.40",
      description: "First",
      category: "Other",
    });
    expect((await c.state()).savingsBalances.ILS).toBe(0);
    const goal = await c.send("/goals", {
      requestId: randomUUID(),
      currency: "ILS",
      amount: "1000",
      name: "Laptop",
    });
    await c.send("/preferences", { savings: "enabled" }, "PUT");
    await c.send("/purchases", {
      requestId: randomUUID(),
      currency: "ILS",
      amount: "23.40",
      description: "Second",
      category: "Other",
    });
    let s = await c.state();
    expect(s.preferences.goalIds.ILS).toBe(goal.data.id);
    expect(s.preferences.notifications).toBe(false);
    expect(s.ledger.at(-1)?.goalId).toBe(goal.data.id);
    await c.send("/reports", { frequency: "weekly" });
    s = await c.state();
    const rec = s.recommendations[0];
    expect(s.preferences.increments.ILS).toBe(500);
    await c.send(`/recommendations/${rec.id}`, { decision: "dismissed" });
    expect((await c.state()).preferences.increments.ILS).toBe(500);
  });
  it("previews and confirms a conversion with server rates, rejects stale or altered quotes", async () => {
    const snap = parsePma(
      "<tr><th>USD/ILS</th><td>3.5</td><td>3.5</td></tr><tr><th>JOD/ILS</th><td>5</td><td>5</td></tr>",
    );
    await update<Snapshot[], void>(
      "rates",
      () => [],
      (s) => {
        s.splice(0, s.length, snap);
      },
    );
    const c = await client();
    const input = { from: "USD", to: "ILS", amount: "100" };
    const q = await c.send("/conversions/preview", input);
    expect(q.data.received).toBe(35000);
    const body = {
      ...input,
      requestId: randomUUID(),
      snapshotId: q.data.snapshotId,
      rate: q.data.rate,
      expiresAt: q.data.expiresAt,
    };
    expect((await c.send("/conversions", { ...body, rate: 1 })).status).toBe(
      400,
    );
    expect((await c.send("/conversions", body)).status).toBe(200);
    await c.send("/conversions", body);
    const s = await c.state();
    expect(s.balances.USD).toBe(110000);
    expect(s.balances.ILS).toBe(685000);
    expect(s.ledger.filter((e) => e.kind === "conversion")).toHaveLength(1);
    await update<Snapshot[], void>(
      "rates",
      () => [],
      (s) => {
        s[0].fetchedAt = "2020-01-01T00:00:00.000Z";
      },
    );
    expect((await c.send("/conversions/preview", input)).status).toBe(400);
  });
  it("rejects recommendations after cap, activation, or ledger changes", async () => {
    const c = await client();
    await c.send("/preferences", { savings: "enabled" }, "PUT");
    const p = await c.send("/purchases", {
      requestId: randomUUID(),
      currency: "ILS",
      amount: "23.40",
      description: "Test",
      category: "Other",
    });
    await c.send("/reports", { frequency: "weekly" });
    const state = await c.state();
    const recommendation = state.recommendations[0];
    await c.send(
      "/preferences",
      { caps: { ...state.preferences.caps, ILS: 100 } },
      "PUT",
    );
    expect(
      (
        await c.send(`/recommendations/${recommendation.id}`, {
          decision: "accepted",
        })
      ).status,
    ).toBe(400);
    await c.send(
      "/preferences",
      { caps: state.preferences.caps, savings: "disabled" },
      "PUT",
    );
    expect(
      (
        await c.send(`/recommendations/${recommendation.id}`, {
          decision: "accepted",
        })
      ).status,
    ).toBe(400);
    await c.send("/preferences", { savings: "enabled" }, "PUT");
    await c.send("/refunds", { id: p.data.id, requestId: randomUUID() });
    expect(
      (
        await c.send(`/recommendations/${recommendation.id}`, {
          decision: "accepted",
        })
      ).status,
    ).toBe(400);
    expect((await c.state()).preferences.increments.ILS).toBe(500);
  });
  it("analyzes the server-owned balance when no amount is supplied", async () => {
    const snap = parsePma(
      "<tr><th>USD/ILS</th><td>3.5</td><td>3.5</td></tr><tr><th>JOD/ILS</th><td>5</td><td>5</td></tr>",
    );
    await update<Snapshot[], void>(
      "rates",
      () => [],
      (s) => {
        s.splice(0, s.length, snap);
      },
    );
    const c = await client();
    const result = await c.send("/rates/insight", { from: "USD", to: "ILS" });
    expect(result.status).toBe(200);
    expect(result.data.amount).toBe(120000);
    expect(result.data.received).toBe(420000);
    expect(result.data.difference).toBeNull();
    expect((await c.state()).balances.USD).toBe(120000);
  });
  it("rejects anonymous and forged demo requests even when legacy ALLOW_DEMO is true", async () => {
    for (const path of ["/state", "/onboarding"])
      expect((await fetch(base + path)).status).toBe(401);
    for (const path of ["/purchases", "/paypal/orders", "/preferences"]) {
      expect(
        (
          await fetch(base + path, {
            method: path === "/preferences" ? "PUT" : "POST",
            headers: {
              "Content-Type": "application/json",
              "X-WalletWise": "1",
              Cookie: `ww_session=${"a".repeat(64)}`,
            },
            body: "{}",
          })
        ).status,
      ).toBe(401);
    }
  });
  it("rejects missing CSRF headers and untrusted origins", async () => {
    expect(
      (
        await fetch(`${base}/purchases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/preferences`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-WalletWise": "1",
            Origin: "https://untrusted.example",
          },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
});
