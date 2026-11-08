import { loadingResponse } from "./fixtures/loading";
// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { App } from "../src/App";
import { ReportSummary } from "../src/ReportSummary";
import { fundedUser } from "./fixtures/user";
import { balances, purchase } from "../shared/ledger";
import { buildReport } from "../shared/reports";
import type { State } from "../shared/types";
vi.mock("../src/api", () => ({
  initAuth: async () => true,
  api: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../src/useMarketFeed", () => ({ useMarketFeed: () => undefined }));
import { api } from "../src/api";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  location.hash = "";
});
function fixture(): State {
  const d = fundedUser();
  d.preferences.savings = "enabled";
  purchase(d, "ILS", 2340, "Private", "Other");
  return {
    ...d,
    balances: balances(d),
    savingsBalances: balances(d, "savings"),
    snapshots: [],
    authMode: "auth0",
    capabilities: { firebase: false, paypal: false, gemini: true },
  };
}
it("selects weekly/monthly periods, sends a reporting date, shows skeletons and prevents duplicate submissions", async () => {
  const state = fixture();
  location.hash = "#Reports";
  let finish: () => void = () => {};
  vi.mocked(api).mockImplementation(async (path, body) => {
    if (path === "/preferences") {
      Object.assign(state.preferences, body);
      return state.preferences;
    }
    if (path === "/reports") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      state.reports = [buildReport(state, "weekly").report];
      return state.reports[0];
    }
    return loadingResponse(path, state);
  });
  render(<App />);
  const select = await screen.findByLabelText("Report frequency");
  expect((select as HTMLSelectElement).value).toBe("monthly");
  fireEvent.change(select, { target: { value: "weekly" } });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Report frequency") as HTMLSelectElement).value,
    ).toBe("weekly"),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Generate report",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Reporting date"), {
    target: { value: "2026-09-15" },
  });
  const button = screen.getByRole("button", { name: "Generate report" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    await screen.findByRole("status", { name: "Generating report" }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: /Generating/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    vi.mocked(api).mock.calls.filter(([path]) => path === "/reports"),
  ).toHaveLength(1);
  expect(api).toHaveBeenCalledWith(
    "/reports",
    expect.objectContaining({
      frequency: "weekly",
      date: "2026-09-15",
      timezone: expect.any(String),
    }),
  );
  await act(async () => finish());
  await screen.findByRole("heading", { name: "Spending by category" });
});
it("renders validated AI sections as plain text and keeps provider failures distinct from totals", () => {
  const state = fixture();
  const report = buildReport(state, "weekly").report;
  report.source = "Gemini";
  report.status = "complete";
  report.aiContent = {
    summary: "Recorded spending supports a review.",
    spendingInsights: ["<script>alert('x')</script>"],
    savingsInsights: ["Round-ups contributed to savings."],
    recommendations: [],
    nextSteps: ["Review your rule settings."],
  };
  const { container, rerender } = render(
    <ReportSummary
      state={state}
      report={report}
      busy={false}
      run={async () => true}
    />,
  );
  expect(
    screen.getByRole("region", { name: "AI financial insights" }),
  ).toBeTruthy();
  expect(screen.getByText("<script>alert('x')</script>")).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  rerender(
    <ReportSummary
      state={state}
      report={{
        ...report,
        source: "deterministic",
        status: "ai_unavailable",
        aiContent: undefined,
      }}
      busy={false}
      run={async () => true}
    />,
  );
  expect(screen.getByText(/AI insights could not be generated/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: /23\.40/ })).toBeTruthy();
});
it("refreshes after explicit recommendation acceptance and dismissal without changing rules itself", async () => {
  const state = fixture();
  const result = buildReport(state, "weekly");
  state.reports = [result.report];
  state.recommendations = result.recommendations;
  const refresh = vi.fn();
  const before = state.preferences.increments.ILS;
  render(
    <ReportSummary
      state={state}
      report={result.report}
      busy={false}
      run={async (work) => {
        await work();
        refresh();
        return true;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept rule" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm rule change" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  expect(api).toHaveBeenCalledWith(
    `/recommendations/${result.recommendations[0].id}`,
    { decision: "accepted" },
  );
  expect(api).toHaveBeenCalledWith(
    `/recommendations/${result.recommendations[0].id}`,
    { decision: "dismissed" },
  );
  expect(state.preferences.increments.ILS).toBe(before);
});
it("keeps currency comparisons separate, handles zero baselines and preserves the saved timestamp", () => {
  const state = fixture();
  state.createdAt = "2026-01-01T00:00:00Z";
  purchase(state, "ILS", 5000, "Prior purchase", "Other").at =
    "2026-08-12T12:00:00Z";
  purchase(state, "ILS", 3000, "Current purchase", "Other").at =
    "2026-09-12T12:00:00Z";
  purchase(state, "USD", 1200, "Current purchase", "Other").at =
    "2026-09-12T12:00:00Z";
  const report = buildReport(
    state,
    "monthly",
    Date.parse("2026-10-15T12:34:00Z"),
    "2026-09-15",
    "Asia/Hebron",
  ).report;
  const { container } = render(
    <ReportSummary
      state={state}
      report={report}
      busy={false}
      run={async () => true}
    />,
  );
  expect(screen.getByText(/20\.00 decrease/)).toBeTruthy();
  expect(screen.getByText("40.0% lower")).toBeTruthy();
  expect(screen.getByText(/12\.00 increase/)).toBeTruthy();
  expect(screen.getByText(/zero baseline/)).toBeTruthy();
  expect(screen.getByText("No change")).toBeTruthy();
  expect(container.querySelector("time")?.dateTime).toBe(report.at);
  expect(container.querySelector(".report-details")?.hasAttribute("open")).toBe(
    false,
  );
  expect(screen.getByText(/Refund-adjusted spending/)).toBeTruthy();
});

it("shows an informational state for each currency without valid comparison history", () => {
  const state = fixture();
  const report = buildReport(state, "monthly").report;
  render(
    <ReportSummary
      state={state}
      report={report}
      busy={false}
      run={async () => true}
    />,
  );
  expect(
    within(
      screen.getByRole("region", { name: "Spending insights" }),
    ).getAllByText(
      "Not enough recorded history for a previous-period comparison.",
    ),
  ).toHaveLength(3);
  expect(screen.queryByText(/% higher|% lower/)).toBeNull();
});
