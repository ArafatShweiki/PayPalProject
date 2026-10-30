// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dashboard } from "../src/Dashboard";
import { SavingsCarousel } from "../src/SavingsCarousel";
import { App } from "../src/App";
import { goalAmount } from "../src/savings";
import { initialUser, balances } from "../shared/ledger";
import type { State } from "../shared/types";
vi.mock("../src/api", () => ({
  initAuth: async () => false,
  api: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
import { api } from "../src/api";
const fixture = (authMode: State["authMode"] = "demo"): State => {
  const data = initialUser(true);
  return {
    ...data,
    authMode,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: [],
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
};
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
  location.hash = "Home";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["demo", "auth0"] as const)(
  "renders honest %s metrics and empty data without fabricating rates",
  (mode) => {
    const state = fixture(mode),
      navigate = vi.fn(),
      create = vi.fn();
    render(
      <Dashboard
        state={state}
        display="ILS"
        setDisplay={vi.fn()}
        onNavigate={navigate}
        onCreate={create}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("₪6,500.00")).toBeTruthy();
    expect(screen.getByText("No rate observations yet.")).toBeTruthy();
    expect(
      screen.getByText("No purchases in this period and currency."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(navigate).toHaveBeenCalledWith("My Wallet");
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    expect(create).toHaveBeenCalledOnce();
  },
);
it("shows loading before asynchronous wallet data arrives", async () => {
  let resolve!: (state: State) => void;
  vi.mocked(api).mockReturnValue(
    new Promise<State>((r) => {
      resolve = r;
    }),
  );
  render(<App />);
  expect(screen.getByText("Getting your wallet ready")).toBeTruthy();
  resolve(fixture());
  expect(await screen.findByText("Spending activity")).toBeTruthy();
});
it("selects and wraps goals with controls and keyboard without saving or creating records", () => {
  const state = fixture(),
    destination = vi.fn();
  state.goals = ["Vacation", "Laptop", "Education"].map((name, i) => ({
    id: String(i),
    name,
    currency: "USD",
    target: 10000,
    createdAt: new Date().toISOString(),
  }));
  render(
    <SavingsCarousel
      state={state}
      busy={false}
      onCreate={vi.fn()}
      onDestination={destination}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "Inspect Vacation" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Next goal" }));
  expect(
    screen
      .getByRole("button", { name: "Inspect Laptop" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.keyDown(screen.getByRole("button", { name: "Inspect Laptop" }), {
    key: "End",
  });
  expect(
    screen
      .getByRole("button", { name: "Inspect Education" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Next goal" }));
  expect(
    screen
      .getByRole("button", { name: "Inspect Vacation" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(destination).not.toHaveBeenCalled();
  expect(state.goals).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Select goal" }));
  expect(destination).toHaveBeenCalledWith(state.goals[0]);
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "instant" }),
  );
});
it("handles empty goals and supports creation", () => {
  const create = vi.fn();
  render(
    <SavingsCarousel
      state={fixture()}
      busy={false}
      onCreate={create}
      onDestination={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
  expect(create).toHaveBeenCalledOnce();
});
it("keeps goal totals synchronized after refunds and state refresh", () => {
  const state = fixture();
  state.goals = [
    {
      id: "g",
      name: "Emergency fund",
      currency: "USD",
      target: 10000,
      createdAt: new Date().toISOString(),
    },
  ];
  const entry = {
    id: "p",
    at: new Date().toISOString(),
    kind: "purchase" as const,
    currency: "USD" as const,
    amount: 2500,
    saved: 500,
    description: "Books",
    category: "Education",
    goalId: "g",
    postings: [],
  };
  state.ledger.push(entry);
  const props = { busy: false, onCreate: vi.fn(), onDestination: vi.fn() };
  const view = render(<SavingsCarousel state={state} {...props} />);
  expect(
    screen.getByLabelText("Selected goal progress").getAttribute("value"),
  ).toBe("500");
  const next = {
    ...state,
    ledger: [...state.ledger, { ...entry, id: "r", kind: "refund" as const }],
  };
  view.rerender(<SavingsCarousel state={next} {...props} />);
  expect(goalAmount(next, "g")).toBe(0);
  expect(
    screen.getByLabelText("Selected goal progress").getAttribute("value"),
  ).toBe("0");
});
import { CurrencyTrends, SpendingActivity } from "../src/Dashboard";
it("filters spending by currency and period and exposes exact chart amounts", () => {
  const state = fixture();
  state.ledger.push({
    id: "purchase",
    at: new Date().toISOString(),
    kind: "purchase",
    currency: "USD",
    amount: 1299,
    saved: 1,
    description: "Coffee",
    category: "Food",
    postings: [],
  });
  render(<SpendingActivity state={state} />);
  fireEvent.change(screen.getByLabelText("Spending currency"), {
    target: { value: "USD" },
  });
  expect(screen.getByText("$12.99")).toBeTruthy();
  expect(screen.getByRole("button", { name: /\$12.99/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Period"), {
    target: { value: "30" },
  });
  expect(screen.getAllByRole("button")).toHaveLength(30);
});
it("shows only stored rate history and requires a comparison observation", () => {
  const state = fixture();
  state.snapshots = [
    {
      id: "one",
      fetchedAt: new Date().toISOString(),
      source: "sample",
      publishedAt: null,
      ils: { ILS: 1000000, USD: 3500000, JOD: 4900000 },
      quotes: [],
    },
  ];
  const view = render(<CurrencyTrends state={state} />);
  expect(screen.getByText("Insufficient comparison history")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(
    <CurrencyTrends
      state={{
        ...state,
        snapshots: [
          ...state.snapshots,
          {
            ...state.snapshots[0],
            id: "two",
            ils: { ...state.snapshots[0].ils, USD: 3430000 },
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("-2.00%")).toBeTruthy();
  expect(screen.getByRole("img").querySelectorAll("circle")).toHaveLength(2);
});
