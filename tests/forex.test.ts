vi.hoisted(() => {
  process.env.DATABASE_PATH = "data/forex-test.db";
});
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  parseForexQuotes,
  forexUnits,
  refreshForex,
  forexStatus,
} from "../server/forex";
import { update } from "../server/store";
import { readForexSnapshots } from "../server/forex-store";
import { isQuoteStale, pairStatus, snapshotRate } from "../shared/market";
const stamp = Math.floor(Date.now() / 1000),
  symbols = ["USD/ILS", "USD/JOD"];
const quotes = (at = stamp, closed = false) => [
  {
    symbol: "USD/ILS",
    close: "3.50000000",
    timestamp: at,
    last_quote_at: at,
    is_market_open: !closed,
  },
  {
    symbol: "USD/JOD",
    close: "0.70000000",
    timestamp: at,
    last_quote_at: at,
    is_market_open: !closed,
  },
];
beforeEach(async () => {
  vi.stubEnv("MARKET_DATA_PROVIDER", "twelve");
  vi.stubEnv("TWELVE_DATA_API_KEY", "fixture-key");
  vi.stubEnv("FOREX_POLL_MS", "60000");
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (record) => {
      for (const key of Object.keys(record)) delete record[key];
    },
  );
  await update<unknown[], void>(
    "forex_snapshots",
    () => [],
    (list) => {
      list.length = 0;
    },
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("validates decimal prices, quote identity, timestamp and synchronized legs", () => {
  expect(forexUnits("3.12345675")).toBe(3123457);
  expect(() => forexUnits("NaN")).toThrow();
  expect(() => forexUnits("0")).toThrow();
  expect(() => parseForexQuotes(quotes(), ["ILS/USD", "USD/JOD"])).toThrow();
  expect(() =>
    parseForexQuotes(quotes(stamp + 3600), symbols, stamp * 1000),
  ).toThrow();
  const mismatched = quotes();
  mismatched[1].timestamp = stamp - 600;
  mismatched[1].last_quote_at = stamp - 600;
  expect(() => parseForexQuotes(mismatched, symbols, stamp * 1000)).toThrow(
    /far apart/,
  );
});
it("calculates direct, inverse and cross rates and treats provider closures/staleness honestly", () => {
  const snapshot = parseForexQuotes(quotes(stamp, true), symbols, stamp * 1000);
  expect(snapshotRate(snapshot, "USD", "ILS")).toBe(3500000);
  expect(snapshotRate(snapshot, "USD", "JOD")).toBe(700000);
  expect(snapshotRate(snapshot, "JOD", "ILS")).toBe(5000000);
  expect(snapshotRate(snapshot, "ILS", "JOD")).toBe(200000);
  expect(snapshotRate(snapshot, "JOD", "USD")).toBe(1428571);
  expect(pairStatus(snapshot, "JOD", "ILS")).toBe("closed");
  expect(
    isQuoteStale(snapshot, "USD", "ILS", 180000, stamp * 1000 + 180001),
  ).toBe(true);
  const inverse = parseForexQuotes(
    [
      { ...quotes()[0], symbol: "ILS/USD", close: "0.28571429" },
      { ...quotes()[1], symbol: "JOD/USD", close: "1.42857143" },
    ],
    ["ILS/USD", "JOD/USD"],
    stamp * 1000,
  );
  expect(snapshotRate(inverse, "USD", "ILS")).toBeCloseTo(3500000, -1);
});
function providerFetch(at = stamp, price = "3.50000000") {
  return vi.fn(async (url: URL | RequestInfo) => {
    const symbol = new URL(String(url)).searchParams.get("symbol");
    return new Response(
      JSON.stringify({
        ...quotes(at)[symbol === "USD/ILS" ? 0 : 1],
        ...(symbol === "USD/ILS" ? { close: price } : {}),
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
}
it("shares polling, persists observations, and never duplicates an unchanged provider timestamp", async () => {
  const fetcher = providerFetch();
  vi.stubGlobal("fetch", fetcher);
  await Promise.all([refreshForex(), refreshForex(), refreshForex()]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await refreshForex();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await readForexSnapshots()).toHaveLength(1);
  expect(fetcher.mock.calls[0][0].toString()).not.toContain("fixture-key");
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      s.nextAttemptAt = "2000-01-01T00:00:00Z";
    },
  );
  await refreshForex();
  expect(await readForexSnapshots()).toHaveLength(1);
});
it("backs off on provider 429 and retains prior data without fabricating prices", async () => {
  vi.stubGlobal("fetch", providerFetch());
  await refreshForex();
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      s.nextAttemptAt = "2000-01-01T00:00:00Z";
    },
  );
  const limited = vi.fn(
    async () =>
      new Response(JSON.stringify({ code: 429, status: "error" }), {
        status: 429,
        headers: { "retry-after": "120", "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", limited);
  expect(await refreshForex()).toHaveLength(1);
  expect((await forexStatus()).connection).toBe("unavailable");
  expect(Date.parse((await forexStatus()).nextAttemptAt!)).toBeGreaterThan(
    Date.now() + 110000,
  );
  await refreshForex();
  expect(limited).toHaveBeenCalledTimes(2);
});
it("enforces configured daily budgets before provider calls", async () => {
  vi.stubEnv("TWELVE_DATA_DAILY_CREDITS", "2");
  const fetcher = providerFetch();
  vi.stubGlobal("fetch", fetcher);
  await refreshForex();
  await update<Record<string, unknown>, void>(
    "twelve_status",
    () => ({}),
    (s) => {
      s.nextAttemptAt = "2000-01-01T00:00:00Z";
    },
  );
  await refreshForex();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await forexStatus()).error).toMatch(/budget exhausted/);
});
it("fails closed without credentials and never substitutes PMA data", async () => {
  vi.stubEnv("TWELVE_DATA_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(refreshForex()).rejects.toMatchObject({ status: 503 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await readForexSnapshots()).toEqual([]);
});

it("revalidates a changed key rather than treating old cached credentials as available", async () => {
  const first = providerFetch();
  vi.stubGlobal("fetch", first);
  await refreshForex();
  vi.stubEnv("TWELVE_DATA_API_KEY", "invalid-fixture-key");
  const denied = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "error", code: 401 }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", denied);
  await expect(refreshForex()).rejects.toMatchObject({ status: 503 });
  expect(denied).toHaveBeenCalledTimes(2);
  expect((await forexStatus()).connection).toBe("unavailable");
  expect(await forexStatus()).not.toHaveProperty("credentialHash");
});
