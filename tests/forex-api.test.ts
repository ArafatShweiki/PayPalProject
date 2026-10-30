vi.hoisted(() => {
  process.env.DATABASE_PATH = "data/forex-api-test.db";
});
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
vi.mock("../server/store", async (original) => ({
  ...(await original<typeof import("../server/store")>()),
  firebaseEnabled: true,
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("forex-user-")) throw new Error("invalid");
      return { uid: token };
    },
  }),
}));
import { app } from "../server/app";
import { update, userRead } from "../server/store";
import { initialUser } from "../shared/ledger";
import type { State } from "../shared/types";
import { parseForexQuotes } from "../server/forex";
import { persistForex } from "../server/forex-store";
let server: Server,
  base: string,
  price = "3.5",
  stamp = 0,
  uid = "";
const networkFetch = globalThis.fetch;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  vi.stubEnv("MARKET_DATA_PROVIDER", "twelve");
  vi.stubEnv("TWELVE_DATA_API_KEY", "fixture-key");
  vi.stubEnv("FOREX_POLL_MS", "60000");
  uid = `forex-user-${randomUUID()}`;
  price = "3.5";
  stamp = Math.floor(Date.now() / 1000);
  await update(
    `user_${uid}`,
    () => initialUser(true),
    () => {},
  );
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      Object.keys(s).forEach((key) => delete s[key]);
    },
  );
  await update<{ id: string }, void>(
    "forex_alerts_checkpoint",
    () => ({ id: "" }),
    (s) => {
      s.id = "";
    },
  );
  await update<unknown[], void>(
    "forex_snapshots",
    () => [],
    (s) => {
      s.length = 0;
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | RequestInfo) => {
      const symbol = new URL(String(url)).searchParams.get("symbol");
      return new Response(
        JSON.stringify({
          symbol,
          close: symbol === "USD/ILS" ? price : "0.7",
          timestamp: stamp,
          is_market_open: true,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function request(path: string, body?: unknown) {
  const response = await networkFetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${uid}`,
      "Content-Type": "application/json",
      "X-WalletWise": "1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
it("uses retained market history for a selected comparison and reports unavailable longer periods", async () => {
  const at = Math.floor(Date.now() / 1000);
  for (const [days, value] of [
    [2, "3.4"],
    [0, "3.5"],
  ] as const) {
    await persistForex(
      parseForexQuotes(
        [
          { symbol: "USD/ILS", close: value, timestamp: at - days * 86400 },
          { symbol: "USD/JOD", close: "0.7", timestamp: at - days * 86400 },
        ],
        ["USD/ILS", "USD/JOD"],
      ),
    );
  }
  const result = await request("/rates/insight", {
    from: "USD",
    to: "ILS",
    amount: "100",
    period: "24h",
  });
  expect(result.status).toBe(200);
  expect(result.data.difference).toBe(1000);
  expect(result.data.referenceAt).toBe(
    new Date((at - 2 * 86400) * 1000).toISOString(),
  );
  const unavailable = await request("/rates/insight", {
    from: "USD",
    to: "ILS",
    amount: "100",
    period: "7d",
  });
  expect(unavailable.data.referenceRate).toBeNull();
  expect(unavailable.data.changePercent).toBeNull();
});
it("previews, confirms atomically, records provenance and deduplicates simulated Forex conversions", async () => {
  const preview = await request("/conversions/preview", {
    from: "USD",
    to: "ILS",
    amount: "100",
  });
  expect(preview.status).toBe(200);
  expect(preview.data).toMatchObject({
    rate: 3500000,
    received: 35000,
    simulatedFee: 0,
    simulatedSpread: 0,
    method: "Direct provider quote",
  });
  const body = {
    from: "USD",
    to: "ILS",
    amount: "100",
    requestId: randomUUID(),
    rate: preview.data.rate,
    snapshotId: preview.data.snapshotId,
    expiresAt: preview.data.expiresAt,
  };
  const first = await request("/conversions", body),
    second = await request("/conversions", body);
  expect(first.status).toBe(200);
  expect(second.data.id).toBe(first.data.id);
  const state = (await request("/state")).data as State;
  expect(state.balances.USD).toBe(110000);
  expect(state.balances.ILS).toBe(685000);
  expect(state.ledger.filter((e) => e.kind === "conversion")).toHaveLength(1);
  expect(state.ledger.at(-1)?.quoteSource).toBe("https://twelvedata.com/forex");
});
it("requires a new confirmation after price changes and prevents overdrafts", async () => {
  const input = { from: "USD", to: "ILS", amount: "100" };
  const q = (await request("/conversions/preview", input)).data;
  price = "3.7";
  stamp++;
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      s.nextAttemptAt = "2000-01-01T00:00:00Z";
    },
  );
  const result = await request("/conversions", {
    ...input,
    rate: q.rate,
    snapshotId: q.snapshotId,
    expiresAt: q.expiresAt,
    requestId: randomUUID(),
  });
  expect(result.status).toBe(400);
  expect(result.data.error).toMatch(/Rate changed/);
  const tooLarge = { ...input, amount: "999999" },
    newQ = (await request("/conversions/preview", tooLarge)).data;
  expect(
    (
      await request("/conversions", {
        ...tooLarge,
        rate: newQ.rate,
        snapshotId: newQ.snapshotId,
        expiresAt: newQ.expiresAt,
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (await userRead(uid)).ledger.filter((e) => e.kind === "conversion"),
  ).toHaveLength(0);
});

it("delivers target-crossing notices in the private live feed without leaking them across accounts", async () => {
  await update(
    `user_${uid}`,
    () => initialUser(true),
    (data) => {
      data.preferences.notifications = true;
      data.alerts = [
        {
          id: "watch",
          from: "USD",
          to: "ILS",
          direction: "increase",
          mode: "target",
          threshold: 3.6,
          reference: 3500000,
          enabled: true,
        },
      ];
    },
  );
  expect((await request("/rates/live")).data.notices).toHaveLength(0);
  price = "3.7";
  stamp++;
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      s.nextAttemptAt = "2000-01-01T00:00:00Z";
    },
  );
  expect((await request("/rates/live")).data.notices).toHaveLength(1);
  expect((await request("/rates/live")).data.notices).toHaveLength(1);
  uid = `forex-user-${randomUUID()}`;
  await update(
    `user_${uid}`,
    () => initialUser(true),
    () => {},
  );
  expect((await request("/rates/live")).data.notices).toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(4);
});
