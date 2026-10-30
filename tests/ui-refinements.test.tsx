// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { initialUser, balances, purchase } from "../shared/ledger";
import { buildReport } from "../shared/reports";
import type { State } from "../shared/types";
import { SettingsForm } from "../src/Settings";
import { ReportSummary } from "../src/ReportSummary";
import { CurrencyPerspective } from "../src/Rates";
import { currencyFacts } from "../shared/currency-insights";
import { api } from "../src/api";
vi.mock("../src/api", () => ({ api: vi.fn(async () => ({})) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture(): State {
  const d = initialUser(true);
  d.preferences.savings = "enabled";
  purchase(d, "ILS", 2340, "Coffee", "Food & drink");
  const { report, recommendations } = buildReport(d, "weekly");
  return {
    ...d,
    reports: [report],
    recommendations,
    balances: balances(d),
    savingsBalances: balances(d, "savings"),
    snapshots: [],
    authMode: "demo",
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
}
it("keeps cap inputs accessible and saves currency precision without changing increments", () => {
  const state = fixture(),
    save = vi.fn(async () => true);
  render(<SettingsForm state={state} busy={false} save={save} />);
  for (const c of ["ILS", "USD", "JOD"])
    expect(
      screen.getByLabelText(`${c} maximum automatic savings per purchase`),
    ).toBeTruthy();
  fireEvent.change(
    screen.getByLabelText("JOD maximum automatic savings per purchase"),
    { target: { value: "0.125" } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Save preferences/ }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      caps: { ...state.preferences.caps, JOD: 125 },
      increments: state.preferences.increments,
    }),
  );
});
it("shows stale insights as recorded values without a current movement claim", async () => {
  const snapshot = {
    id: "expired",
    source: "https://twelvedata.com/forex",
    fetchedAt: "2020-01-01T00:00:00Z",
    publishedAt: null,
    quotes: [],
    ils: { ILS: 1000000, USD: 3500000, JOD: 5000000 },
  };
  vi.mocked(api).mockResolvedValueOnce(
    currencyFacts([snapshot], "USD", "ILS", 10000),
  );
  render(
    <CurrencyPerspective
      state={fixture()}
      busy={false}
      run={async (work) => {
        await work();
        return true;
      }}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Explain this conversion" }),
  );
  expect(
    await screen.findByText(/Last recorded indicative value/),
  ).toBeTruthy();
  expect(
    screen.getByText("Refresh rates for a current comparison."),
  ).toBeTruthy();
  expect(screen.queryByText(/would get you/)).toBeNull();
});
it("keeps report currencies separate, omits missing comparisons and wires explicit rule decisions", async () => {
  const state = fixture();
  render(
    <ReportSummary
      state={state}
      report={state.reports[0]}
      busy={false}
      run={async (work) => {
        await work();
        return true;
      }}
    />,
  );
  const card = screen
    .getByRole("heading", { name: "ILS", level: 3 })
    .closest("article")!;
  expect(within(card).getByRole("heading", { name: "₪23.40" })).toBeTruthy();
  expect(within(card).getByText("₪1.60")).toBeTruthy();
  expect(screen.queryByText(/Previous period/)).toBeNull();
  expect(
    screen
      .getByRole("progressbar", { name: "ILS Food & drink spending" })
      .getAttribute("value"),
  ).toBe("2340");
  expect(screen.getByText("Current rule")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept rule" }));
  expect(api).toHaveBeenCalledWith(
    `/recommendations/${state.recommendations[0].id}`,
    { decision: "accepted" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(api).toHaveBeenCalledWith(
    `/recommendations/${state.recommendations[0].id}`,
    { decision: "dismissed" },
  );
});
