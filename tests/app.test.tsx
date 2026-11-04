import { loadingResponse } from "./fixtures/loading";
import type { State } from "../shared/types";
import { fundedUser } from "./fixtures/user";
// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { balances } from "../server/ledger";
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
  const data = fundedUser();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/rates/live"
      ? {
          snapshots: [],
          status: {
            provider: "PMA",
            staleMs: 3600000,
            connection: "connected",
          },
        }
      : loadingResponse(path, {
          ...data,
          balances: balances(data),
          savingsBalances: balances(data, "savings"),
          snapshots: [],
          authMode: "auth0",
          capabilities: { firebase: false, paypal: false, gemini: false },
        } as State),
  );
  render(<App />);
  expect(await screen.findByText("Your money, in perspective.")).toBeTruthy();
  expect(screen.getByText("₪6,500.00")).toBeTruthy();
  expect(await screen.findByText("No rate observations yet.")).toBeTruthy();
  expect(screen.queryByText("Demo Mode", { exact: true })).toBeNull();
  expect(screen.queryByText(/This is a simulated wallet/)).toBeNull();
  expect(screen.queryByText(/Simulated balances\. Real attention/)).toBeNull();
});
