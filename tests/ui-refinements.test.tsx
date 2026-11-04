import { fundedUser } from "./fixtures/user";
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
import { balances, purchase } from "../shared/ledger";
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
  const d = fundedUser();
  d.preferences.savings = "enabled";
  purchase(d, "ILS", 2340, "Coffee", "Food & drink");
  const { report, recommendations } = buildReport(
    d,
    "weekly",
    Date.now() + 1000,
  );
  return {
    ...d,
    reports: [report],
    recommendations,
    balances: balances(d),
    savingsBalances: balances(d, "savings"),
    snapshots: [],
    authMode: "auth0",
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
}
it("saves round-up increments with currency precision while preserving existing caps", () => {
  const state = fixture(),
    save = vi.fn(async () => true);
  render(<SettingsForm state={state} busy={false} save={save} />);
  expect(
    screen.queryByText("Maximum automatic savings per purchase"),
  ).toBeNull();
  fireEvent.change(document.querySelector('input[name="increment-JOD"]')!, {
    target: { value: "0.125" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Save preferences/ }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      caps: state.preferences.caps,
      increments: { ...state.preferences.increments, JOD: 125 },
    }),
  );
});
it("synchronizes the savings checkbox with refreshed account preferences and saves the selected state", () => {
  const state = fixture(),
    save = vi.fn(async () => true);
  const view = render(<SettingsForm state={state} busy={false} save={save} />);
  const checkbox = () =>
    screen.getByRole("checkbox", {
      name: "Automatically allocate round-ups after successful simulated purchases",
    }) as HTMLInputElement;
  expect(checkbox().checked).toBe(true);
  fireEvent.click(checkbox());
  expect(checkbox().checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /Save preferences/ }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ savings: "disabled" }),
  );
  // A fresh authoritative snapshot can retain enabled (for example after a failed save).
  view.rerender(
    <SettingsForm
      state={{ ...state, preferences: { ...state.preferences } }}
      busy={false}
      save={save}
    />,
  );
  expect(checkbox().checked).toBe(true);
  const disabled = {
    ...state,
    preferences: { ...state.preferences, savings: "disabled" as const },
  };
  view.rerender(<SettingsForm state={disabled} busy={false} save={save} />);
  expect(checkbox().checked).toBe(false);
  fireEvent.click(checkbox());
  fireEvent.click(screen.getByRole("button", { name: /Save preferences/ }));
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ savings: "enabled" }),
  );
  view.rerender(<SettingsForm state={state} busy={true} save={save} />);
  expect(checkbox().checked).toBe(true);
  expect(checkbox().disabled).toBe(true);
});
it("resynchronizes notification choices after an authoritative refresh", () => {
  const state = fixture(),
    save = vi.fn(async () => true);
  state.preferences.notifications = true;
  const view = render(<SettingsForm state={state} busy={false} save={save} />);
  const checkbox = () =>
    screen.getByLabelText(
      "Enable in-app currency notifications",
    ) as HTMLInputElement;
  fireEvent.click(checkbox());
  expect(checkbox().checked).toBe(false);
  view.rerender(
    <SettingsForm
      state={{ ...state, preferences: { ...state.preferences } }}
      busy={false}
      save={save}
    />,
  );
  expect(checkbox().checked).toBe(true);
  expect(
    screen.getByRole("option", { name: "Monthly (calendar month)" }),
  ).toBeTruthy();
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
  expect(within(card).getAllByText("₪1.60")).toBeTruthy();
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
