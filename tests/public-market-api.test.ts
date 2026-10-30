vi.hoisted(() => {
  process.env.DATABASE_PATH = "data/public-market-test.db";
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
import type { Server } from "node:http";
const market = vi.hoisted(() => ({
  configured: true,
  refresh: vi.fn(),
  snapshots: vi.fn(),
  history: vi.fn(),
  privateRead: vi.fn(() => {
    throw new Error("Private data accessed");
  }),
}));
vi.mock("../server/forex", () => ({
  forexEnabled: () => process.env.MARKET_DATA_PROVIDER === "twelve",
  forexPollMs: () => 60000,
  forexStaleMs: () => 180000,
  forexStatus: async () => ({
    provider: "Twelve Data",
    configured: market.configured,
    connection: "connected",
    transport: "polling",
    pollMs: 60000,
    staleMs: 180000,
  }),
  refreshForex: market.refresh,
}));
vi.mock("../server/forex-store", () => ({
  readForexSnapshots: market.snapshots,
  forexHistory: market.history,
}));
vi.mock("../server/store", async (original) => ({
  ...(await original<typeof import("../server/store")>()),
  userRead: market.privateRead,
  userUpdate: market.privateRead,
  users: market.privateRead,
}));
import { app } from "../server/app";
import { update } from "../server/store";
import { fingerprint } from "../server/reliability";
let server: Server, base: string;
const point = {
  id: "quote",
  fetchedAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
  source: "https://twelvedata.com/forex",
  quotes: [],
  ils: { ILS: 1000000, USD: 3500000, JOD: 5000000 },
  market: {
    provider: "Twelve Data",
    timeKind: "minute quote",
    legs: [
      {
        symbol: "USD/ILS",
        rate: 3500000,
        observedAt: new Date().toISOString(),
        marketOpen: true,
      },
      {
        symbol: "USD/JOD",
        rate: 700000,
        observedAt: new Date().toISOString(),
        marketOpen: true,
      },
    ],
  },
  auth0Sub: "must-not-leak",
  notices: [{ body: "private" }],
};
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_ENABLE_DEMO_MODE", "true");
  vi.stubEnv("MARKET_DATA_PROVIDER", "twelve");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("RATE_LIMIT_PUBLIC_MARKET", "30");
  market.configured = true;
  market.refresh.mockResolvedValue([point]);
  market.snapshots.mockResolvedValue([point]);
  market.history.mockResolvedValue([point]);
  await update<Record<string, unknown>, void>(
    `limit_public-market_${fingerprint("127.0.0.1").slice(0, 2)}`,
    () => ({}),
    (s) => {
      Object.keys(s).forEach((k) => delete s[k]);
    },
  );
});
afterEach(() => vi.unstubAllEnvs());
it("returns only market fields without authenticating or touching private records", async () => {
  const response = await fetch(base + "/api/market-data/live", {
    headers: { authorization: "Bearer forged" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json();
  expect(body.snapshots).toHaveLength(1);
  expect(JSON.stringify(body)).not.toMatch(
    /must-not-leak|private|notices|auth0Sub/,
  );
  expect(market.privateRead).not.toHaveBeenCalled();
  expect(market.refresh).toHaveBeenCalledOnce();
  expect((await fetch(base + "/api/state")).status).toBe(401);
});
it("never substitutes samples when provider/key configuration is missing", async () => {
  market.configured = false;
  const body = await (await fetch(base + "/api/market-data/live")).json();
  expect(body.snapshots).toEqual([]);
  expect(body.status.connection).toBe("unavailable");
  expect(body.status.error).toMatch(/TWELVE_DATA_API_KEY/);
  expect(market.refresh).not.toHaveBeenCalled();
  expect(market.snapshots).not.toHaveBeenCalled();
});
it("supports read-only history and rejects mutation methods and private-looking paths", async () => {
  expect(
    (await fetch(base + "/api/market-data/history?period=24h")).status,
  ).toBe(200);
  expect(
    (await fetch(base + "/api/market-data/live", { method: "POST" })).status,
  ).toBe(405);
  expect(
    (await fetch(base + "/api/market-data/purchases", { method: "POST" }))
      .status,
  ).toBe(405);
  expect(market.privateRead).not.toHaveBeenCalled();
});
it("enforces public read limits with Retry-After", async () => {
  vi.stubEnv("RATE_LIMIT_PUBLIC_MARKET", "2");
  await fetch(base + "/api/market-data/live");
  await fetch(base + "/api/market-data/live");
  const denied = await fetch(base + "/api/market-data/live");
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(market.refresh).toHaveBeenCalledTimes(2);
});
it.each(["production", "vercel", "disabled"])(
  "does not expose anonymous demo market data in %s",
  async (mode) => {
    if (mode === "production") vi.stubEnv("NODE_ENV", "production");
    if (mode === "vercel") vi.stubEnv("VERCEL", "1");
    if (mode === "disabled") vi.stubEnv("VITE_ENABLE_DEMO_MODE", "false");
    expect((await fetch(base + "/api/market-data/live")).status).toBe(404);
    expect(market.refresh).not.toHaveBeenCalled();
  },
);
