import { test, expect, type Page } from "@playwright/test";
import { enterDemo } from "./fixtures";

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
test("refined reports, settings, wallet and perspective retain their working flows", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "Settings");
  for (const c of ["ILS", "USD", "JOD"])
    await expect(
      page.getByLabel(`${c} maximum automatic savings per purchase`),
    ).toBeVisible();
  await page
    .getByLabel("JOD maximum automatic savings per purchase")
    .fill("0.125");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await expect(
    page.getByLabel("JOD maximum automatic savings per purchase"),
  ).toHaveValue("0.125");
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/refined-settings-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await navigate(page, "My Wallet");
  await expect(
    page.getByRole("button", { name: "Preview conversion" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Wallet activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simulate purchase", exact: true }),
  ).toBeVisible();
  await navigate(page, "Reports");
  for (const frequency of ["weekly", "monthly"]) {
    await page
      .getByLabel("Report frequency", { exact: true })
      .selectOption(frequency);
    await page
      .getByRole("button", { name: "Generate report", exact: true })
      .click();
    await expect(page.locator(".report-totals article")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { name: "Spending by category" }),
    ).toBeVisible();
    await expect(
      page.getByText("Previous period: insufficient history"),
    ).toHaveCount(0);
  }
  const rule = page.locator(".recommendation").first();
  await expect(rule.getByText("Estimated additional savings")).toBeVisible();
  const before = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("walletwise:developer-demo:v1")!).data
        .preferences.increments,
  );
  await rule.getByRole("button", { name: "Dismiss", exact: true }).click();
  const after = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("walletwise:developer-demo:v1")!).data
        .preferences.increments,
  );
  expect(after).toEqual(before);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/refined-reports-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await navigate(page, "Currency Rates");
  await page.getByLabel("Insight amount").fill("500");
  await page.getByRole("button", { name: "Explain this conversion" }).click();
  await expect(page.getByText("Rate movement", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What does this mean for you?" }),
  ).toBeVisible();
  await page
    .locator(".perspective-result")
    .screenshot({
      path: "test-results/refined-perspective-result.png",
      animations: "disabled",
    });
  await page
    .getByLabel("Comparison period", { exact: true })
    .selectOption("24h");
  await page.getByRole("button", { name: "Explain this conversion" }).click();
  await expect(
    page.getByText("Insufficient history for this period."),
  ).toBeVisible();
  await expect(page.getByText(/Earliest available observation:/)).toBeVisible();
  await page.screenshot({
    path: "test-results/refined-perspective-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("help search icon and filters align and remain usable across screen sizes", async ({
  page,
}) => {
  await page.goto("/help");
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const input = await page
      .getByLabel("Search help", { exact: true })
      .boundingBox();
    const category = await page
      .getByLabel("Category", { exact: true })
      .boundingBox();
    const icon = await page.locator(".help-search-input svg").boundingBox();
    expect(input && category && icon).toBeTruthy();
    expect(icon!.x).toBeGreaterThan(input!.x);
    expect(icon!.y).toBeGreaterThan(input!.y);
    expect(icon!.y + icon!.height).toBeLessThan(input!.y + input!.height);
    expect(input!.height).toBe(category!.height);
    if (width > 600) expect(Math.abs(input!.y - category!.y)).toBeLessThan(2);
    else expect(category!.y).toBeGreaterThan(input!.y + input!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/refined-help-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("Search help", { exact: true }).fill("round-ups");
  await expect(
    page.getByRole("heading", {
      name: "Activate round-ups and edit savings settings",
    }),
  ).toBeVisible();
  await page
    .getByLabel("Category", { exact: true })
    .selectOption("Troubleshooting");
  await page.getByLabel("Search help", { exact: true }).fill("no-match-xyz");
  await expect(page.getByText(/No matching articles/)).toBeVisible();
  await expect(page.getByText("Frequently asked questions")).toHaveCount(0);
});
