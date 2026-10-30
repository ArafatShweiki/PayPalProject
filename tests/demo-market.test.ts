// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createDemoService } from "../src/demo/service";
import { clearDemoSession, setDemoTransport } from "../src/demoSession";
import { api, setAuth0TokenProvider } from "../src/api";
import { publicRequests } from "../src/requestCache";
import type { State, Snapshot } from "../shared/types";
const point: Snapshot = {
  id: "real-fixture",
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
};
const feed = {
  snapshots: [point],
  status: {
    provider: "Twelve Data",
    configured: true,
    connection: "connected",
    transport: "polling",
    pollMs: 60000,
    staleMs: 180000,
  },
};
beforeEach(() => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_ENABLE_DEMO_MODE", "true");
  sessionStorage.clear();
  publicRequests.clear();
});
afterEach(() => {
  clearDemoSession();
  setAuth0TokenProvider();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("defaults to real data, uses only the public read transport, and keeps conversions local", async () => {
  const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(feed), {
          headers: { "content-type": "application/json" },
        }),
    ),
    token = vi.fn(() => {
      throw new Error("Auth called");
    });
  vi.stubGlobal("fetch", fetcher);
  setAuth0TokenProvider(token);
  setDemoTransport(createDemoService());
  const initial = await api<State>("/state");
  expect(initial.demoMarketMode).toBe("live");
  expect(initial.snapshots).toEqual([]);
  await api("/rates/live");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/market-data/live",
    expect.objectContaining({ method: "GET", credentials: "omit" }),
  );
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
  const input = { from: "USD", to: "ILS", amount: "10" },
    quote = await api<Record<string, unknown>>("/conversions/preview", input);
  await api("/conversions", {
    ...quote,
    ...input,
    requestId: crypto.randomUUID(),
  });
  const state = await api<State>("/state");
  expect(state.balances.USD).toBe(initial.balances.USD - 1000);
  expect(state.ledger.at(-1)?.quoteSource).toBe(point.source);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(token).not.toHaveBeenCalled();
});
it("shows unavailable real data until samples are explicitly selected", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          snapshots: [],
          status: {
            ...feed.status,
            configured: false,
            connection: "unavailable",
            error: "TWELVE_DATA_API_KEY is missing",
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  setDemoTransport(createDemoService());
  await api("/rates/live");
  const unavailable = await api<State>("/state");
  expect(unavailable.snapshots).toEqual([]);
  expect(unavailable.marketStatus?.connection).toBe("unavailable");
  await expect(
    api("/conversions/preview", { from: "USD", to: "ILS", amount: "10" }),
  ).rejects.toThrow(/unavailable/);
  await api("/demo/market-mode", { mode: "sample" });
  const sample = await api<State>("/state");
  expect(sample.demoMarketMode).toBe("sample");
  expect(sample.snapshots).toHaveLength(3);
  await api("/rates/refresh", {});
  expect(fetcher).toHaveBeenCalledOnce();
  await api("/demo/market-mode", { mode: "live" });
  expect((await api<State>("/state")).snapshots).toEqual([]);
});
it("does not resurrect demo storage if an in-flight public read finishes after exit", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  setDemoTransport(createDemoService());
  const pending = api("/rates/live");
  clearDemoSession();
  resolve(
    new Response(JSON.stringify(feed), {
      headers: { "content-type": "application/json" },
    }),
  );
  await pending;
  expect(sessionStorage.getItem("walletwise:developer-demo:v1")).toBeNull();
});
