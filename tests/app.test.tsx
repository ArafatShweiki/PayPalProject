// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { initialUser, balances } from "../server/ledger";
import { App } from "../src/App";
vi.mock("../src/api", () => ({
  initAuth: async () => false,
  api: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
import { api } from "../src/api";
afterEach(cleanup);
it("shows an honest empty dashboard with separate currency balances", async () => {
  const data = initialUser(true);
  vi.mocked(api).mockResolvedValue({
    ...data,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: [],
    authMode: "demo",
    capabilities: { firebase: false, paypal: false, gemini: false },
  });
  render(<App />);
  expect(await screen.findByText("Your money, in perspective.")).toBeTruthy();
  expect(screen.getByText("₪6,500.00")).toBeTruthy();
  expect(screen.getByText("No rate observations yet.")).toBeTruthy();
  expect(screen.getAllByText("Demo Mode", { exact: true })).toHaveLength(1);
  expect(screen.queryByText(/This is a simulated wallet/)).toBeNull();
  expect(screen.queryByText(/Simulated balances\. Real attention/)).toBeNull();
});
