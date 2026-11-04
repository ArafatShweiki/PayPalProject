import { test, expect } from "@playwright/test";
import { mountWalletFixture, walletFixture } from "./fixtures";
import { buildReport } from "../../shared/reports";
import { purchase } from "../../shared/ledger";
import { readFileSync } from "node:fs";

test("report date, structured AI insights, loading state and unavailable AI work together", async ({
  page,
}) => {
  const state = walletFixture();
  state.preferences.savings = "enabled";
  state.preferences.frequency = "monthly";
  purchase(state, "ILS", 2340, "Private merchant", "Other").at =
    "2026-09-15T12:00:00Z";
  const result = buildReport(
    state,
    "monthly",
    Date.parse("2026-10-30T12:00:00Z"),
    "2026-09-15",
  );
  result.report.source = "Gemini";
  result.report.status = "complete";
  result.report.aiContent = {
    summary: "Your recorded activity shows spending and automatic savings.",
    spendingInsights: ["Review the spending categories."],
    savingsInsights: [],
    recommendations: [],
    nextSteps: ["Review your savings rule."],
  };
  await mountWalletFixture(page, "Reports", state);
  await page.route("**/api/preferences", async (route) => {
    Object.assign(state.preferences, route.request().postDataJSON());
    await route.fulfill({ json: state.preferences });
  });
  let finish: () => void = () => {};
  let calls = 0;
  await page.route("**/api/reports", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({
      frequency: "monthly",
      date: "2026-09-15",
      timezone: expect.any(String),
    });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    state.reports = [
      calls === 1
        ? result.report
        : {
            ...result.report,
            source: "deterministic",
            status: "ai_unavailable",
            aiError: "unavailable",
            aiContent: undefined,
          },
    ];
    state.recommendations = result.recommendations;
    await route.fulfill({ json: state.reports[0] });
  });
  await page.getByLabel("Reporting date").fill("2026-09-15");
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Generating report" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Generating/ })).toBeDisabled();
  finish();
  await expect(
    page.getByRole("region", { name: "AI financial insights" }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        "Your recorded activity shows spending and automatic savings.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.locator(".report-totals article")).toHaveCount(3);
  await page
    .locator("details")
    .filter({ hasText: "Monthly review" })
    .locator("summary")
    .click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download report", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^dream-piggy-bank-monthly-.*\.json$/,
  );
  const downloadedReport = JSON.parse(
    readFileSync((await download.path())!, "utf8"),
  );
  expect(downloadedReport).toMatchObject({
    id: result.report.id,
    summaries: result.report.summaries,
    totalSavings: result.report.totalSavings,
  });
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Generating report" }),
  ).toBeVisible();
  finish();
  await expect(
    page.getByText(/AI insights could not be generated/),
  ).toBeVisible();
  await expect(page.locator(".report-totals article")).toHaveCount(3);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/gemini-reports-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
