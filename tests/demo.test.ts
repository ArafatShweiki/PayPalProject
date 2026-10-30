// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createDemoService } from "../src/demo/service";
import {
  clearDemoSession,
  DEMO_STORAGE_KEY,
  demoEnabled,
  setDemoTransport,
} from "../src/demoSession";
import { api, initAuth, setAuth0TokenProvider } from "../src/api";
import { configureSupabase, getBrowserSupabase } from "../src/supabase";
import type { State, Entry } from "../shared/types";
import { sessionState } from "../src/Auth";
beforeEach(() => {
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_ENABLE_DEMO_MODE", "true");
  sessionStorage.clear();
});
afterEach(() => {
  clearDemoSession();
  setAuth0TokenProvider();
  configureSupabase(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([
  [true, "true", true],
  [true, "false", false],
  [true, "", false],
  [false, "true", false],
])("gates DEV=%s flag=%s", (dev, flag, enabled) => {
  vi.stubEnv("DEV", dev);
  vi.stubEnv("VITE_ENABLE_DEMO_MODE", flag);
  expect(demoEnabled()).toBe(enabled);
  if (!enabled) expect(() => createDemoService()).toThrow("disabled");
});
it("keeps loading, unauthenticated, real and development-demo states distinct", () => {
  expect(sessionState(true, false)).toBe("loading");
  expect(sessionState(false, false)).toBe("unauthenticated");
  expect(sessionState(false, true, true)).toBe("authenticated");
  expect(sessionState(false, false, true)).toBe("development-demo");
});
it("isolates all demo operations from network, identity providers and Supabase", async () => {
  const fetch = vi.fn(() => {
    throw new Error("Unexpected network call");
  });
  vi.stubGlobal("fetch", fetch);
  const token = vi.fn(() => {
    throw new Error("Unexpected identity token");
  });
  setAuth0TokenProvider(token);
  configureSupabase({
    url: "https://example.supabase.co",
    publishableKey: "public",
  });
  setDemoTransport(sampleService());
  expect(getBrowserSupabase()).toBeNull();
  expect(await initAuth()).toBe(false);
  const before = await api<State>("/state");
  expect(before.authMode).toBe("demo");
  expect(before.auth0Sub).toBeUndefined();
  expect(before.reports[0].source).toBe("deterministic");
  expect(before.capabilities).toEqual({
    firebase: false,
    paypal: false,
    gemini: false,
  });
  const body = {
    requestId: crypto.randomUUID(),
    currency: "ILS",
    amount: "23.40",
    description: "Test coffee",
    category: "Food & drink",
  };
  const entry = await api<Entry>("/purchases", body);
  await api("/purchases", body); // Retry must not double-debit.
  const after = await api<State>("/state");
  expect(after.balances.ILS).toBe(before.balances.ILS - 2500);
  expect(after.savingsBalances.ILS).toBe(before.savingsBalances.ILS + 160);
  expect(entry.goalId).toBe(before.preferences.goalIds.ILS);
  expect(after.ledger).toHaveLength(before.ledger.length + 1);
  await expect(api("/paypal/orders", {})).rejects.toThrow("disabled");
  await expect(api("/private/new-endpoint", {})).rejects.toThrow("unavailable");
  expect(fetch).not.toHaveBeenCalled();
  expect(token).not.toHaveBeenCalled();
  await api("/refunds", { requestId: crypto.randomUUID(), id: entry.id });
  expect((await api<State>("/state")).balances).toEqual(before.balances);
  expect((await api<State>("/state")).savingsBalances).toEqual(
    before.savingsBalances,
  );
  const restored = createDemoService();
  expect((restored("/state") as State).ledger).toHaveLength(
    before.ledger.length + 2,
  );
  clearDemoSession();
  expect(sessionStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  expect((createDemoService()("/state") as State).ledger).toHaveLength(
    before.ledger.length,
  );
});
it("supports preferences, goals, conversion, reports and simulated notifications locally", () => {
  const request = sampleService();
  const initial = request("/state") as State;
  request(
    "/preferences",
    { name: "Local developer", notifications: false },
    "PUT",
  );
  const goal = request("/goals", {
    requestId: crypto.randomUUID(),
    name: "Trip",
    currency: "USD",
    amount: "500",
  }) as { id: string };
  const input = { from: "USD", to: "ILS", amount: "10" };
  const quote = request("/conversions/preview", input) as object;
  request("/conversions", {
    ...quote,
    ...input,
    requestId: crypto.randomUUID(),
  });
  let state = request("/state") as State;
  expect(state.balances.USD).toBe(initial.balances.USD - 1000);
  expect(state.preferences.name).toBe("Local developer");
  expect(state.preferences.goalIds.USD).toBe(goal.id);
  request("/reports", { frequency: "weekly" });
  state = request("/state") as State;
  expect(state.reports[0].observations[0]).toContain("No live AI request");
  request("/preferences", { notifications: true }, "PUT");
  request("/alerts", {
    requestId: crypto.randomUUID(),
    from: "USD",
    to: "ILS",
    direction: "increase",
    mode: "percent",
    threshold: 0.01,
  });
  request("/rates/refresh", {});
  expect((request("/state") as State).notices.length).toBeGreaterThan(
    initial.notices.length,
  );
  request("/notifications/read", {});
  expect((request("/state") as State).notices.every((n) => n.read)).toBe(true);
  const before = request("/state");
  expect(() =>
    request("/purchases", {
      requestId: crypto.randomUUID(),
      currency: "ILS",
      amount: "999999",
      description: "Too large",
      category: "Other",
    }),
  ).toThrow("Insufficient");
  expect(request("/state")).toEqual(before);
});

function sampleService() {
  const service = createDemoService();
  service("/demo/market-mode", { mode: "sample" });
  return service;
}
