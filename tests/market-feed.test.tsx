// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  renderHook,
  act,
  render,
  screen,
} from "@testing-library/react";
import { useMarketFeed } from "../src/useMarketFeed";
import { MarketRatesPanel } from "../src/MarketRates";
import { initialUser, balances } from "../shared/ledger";
import type { MarketFeed, Snapshot, State } from "../shared/types";
vi.mock("../src/api", () => ({ api: vi.fn() }));
import { api } from "../src/api";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const feed: MarketFeed = {
  snapshots: [],
  status: {
    provider: "Twelve Data",
    configured: true,
    transport: "polling",
    pollMs: 60000,
    staleMs: 180000,
    connection: "connected",
  },
};
it("updates automatically and reconnects after a failed request", async () => {
  vi.useFakeTimers();
  const callback = vi.fn();
  vi.mocked(api)
    .mockResolvedValueOnce(feed)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(feed);
  const { result } = renderHook(() => useMarketFeed("auth0", callback));
  await act(async () => {});
  expect(callback).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(result.current?.connection).toBe("unavailable");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(result.current?.connection).toBe("connected");
  expect(callback).toHaveBeenCalledTimes(2);
});
it("keeps demo interactions local without starting a market feed", () => {
  renderHook(() => useMarketFeed("demo", vi.fn()));
  expect(api).not.toHaveBeenCalled();
});
it("labels actual cross-rates, previous values and provider closures", () => {
  const data = initialUser(true),
    at = Math.floor(Date.now() / 1000);
  const observedAt = new Date(at * 1000).toISOString();
  const snapshot: Snapshot = {
    id: "fixture",
    source: "https://twelvedata.com/forex",
    publishedAt: observedAt,
    fetchedAt: observedAt,
    quotes: [],
    ils: { ILS: 1000000, USD: 3500000, JOD: 5000000 },
    market: {
      provider: "Twelve Data",
      timeKind: "minute quote",
      legs: [
        { symbol: "USD/ILS", rate: 3500000, observedAt, marketOpen: false },
        { symbol: "USD/JOD", rate: 700000, observedAt, marketOpen: false },
      ],
    },
  };
  const state: State = {
    ...data,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    authMode: "auth0",
    capabilities: { firebase: false, paypal: false, gemini: false },
    snapshots: [snapshot],
  };
  render(
    <MarketRatesPanel
      state={state}
      status={feed.status}
      busy={false}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getAllByText("Calculated indicative cross-rate")).toHaveLength(
    2,
  );
  expect(screen.getAllByText("Previous recorded unavailable")).toHaveLength(6);
  expect(screen.getAllByText(/Market closed/)).toHaveLength(6);
});
