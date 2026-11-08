import { test, expect } from "@playwright/test";
import { enterTestWallet, mountWalletFixture, walletFixture } from "./fixtures";
import { buildReport } from "../../shared/reports";
import { purchase } from "../../shared/ledger";
import { readFileSync } from "node:fs";

test("report date, structured AI insights, loading state and unavailable AI work together", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  const state = walletFixture();
  state.createdAt = "2026-01-01T00:00:00Z";
  state.preferences.savings = "enabled";
  for (const [currency, current, previous] of [
    ["ILS", 145620, 162400],
    ["USD", 24850, 19800],
    ["JOD", 92450, 106200],
  ] as const) {
    purchase(state, currency, previous, "Prior activity", "Shopping").at =
      "2026-08-15T12:00:00Z";
    purchase(state, currency, current, "Recorded activity", "Shopping").at =
      "2026-09-15T12:00:00Z";
  }
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
  await page.getByRole("button", { name: /^Reporting date / }).click();
  const calendar = page.getByRole("dialog", { name: "Reporting date date" });
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.locator('[data-date="2026-09-15"]').click();
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Generating report" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Generating/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({
    path: "test-results/report-loading-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
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
  await expect(page.getByText("Report saved.", { exact: true })).toBeHidden();
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/report-viewport-${width}.png`,
      animations: "disabled",
    });
    await page.screenshot({
      path: `test-results/report-summary-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
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
    await page.screenshot({
      path: `test-results/report-fallback-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.screenshot({
    path: "test-results/gemini-reports-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("Smart Savings and Reports share calendar period selection and bordered round-up history", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  await enterTestWallet(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  await expect(
    page.getByText(
      /Historical unassigned savings|Historical savings to assign/,
    ),
  ).toHaveCount(0);
  await page
    .getByLabel("Report frequency", { exact: true })
    .selectOption("weekly");
  await page.getByRole("button", { name: /^Reporting date / }).click();
  const calendar = page.getByRole("dialog", { name: "Reporting date date" });
  await calendar.locator('[data-date="2026-11-05"]').click();
  await expect(page.locator(".report-period-preview")).toContainText(
    "Oct 30, 2026 – Nov 5, 2026",
  );
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const report = JSON.parse(
          sessionStorage.getItem("test-wallet-fixture")!,
        ).data.reports[0];
        return {
          frequency: report.frequency,
          since: new Date(report.since).toLocaleDateString("en-CA", {
            timeZone: report.timezone,
          }),
          until: new Date(report.until).toLocaleDateString("en-CA", {
            timeZone: report.timezone,
          }),
        };
      }),
    )
    .toEqual({
      frequency: "weekly",
      since: "2026-10-30",
      until: "2026-11-06",
    });
  await expect(
    page.getByRole("button", { name: "Generate report", exact: true }),
  ).toBeEnabled();
  const history = page.locator(".roundup-history");
  await expect(history.locator(".transaction").first()).toHaveCSS(
    "border-top-width",
    "1px",
  );
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator(".report-period-controls")
      .screenshot({
        path: `test-results/savings-report-period-${width}.png`,
        animations: "disabled",
      });
    await history.screenshot({
      path: `test-results/roundup-history-${width}.png`,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Reporting date / }),
  ).toContainText("Nov 5, 2026");
  await page
    .locator(".report-period-controls")
    .screenshot({ path: "test-results/reports-period-desktop.png" });
});
