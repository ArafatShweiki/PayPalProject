import { mountWalletFixture } from "./fixtures";
import { test, expect } from "@playwright/test";

// Isolated response fixtures exercise UI behavior; live PMA is verified separately.
test("currency explanation shows computed impact and clears on input change", async ({
  page,
}) => {
  await page.route("**/api/rates/insight", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      from: "USD",
      to: "ILS",
      amount: "500",
    });
    await route.fulfill({
      json: {
        from: "USD",
        to: "ILS",
        amount: 50000,
        rate: 3600000,
        received: 180000,
        referenceRate: 3500000,
        previousValue: 175000,
        difference: 5000,
        changePercent: 2.857142,
        minimumRate: 3500000,
        maximumRate: 3600000,
        observationCount: 2,
        fetchedAt: new Date().toISOString(),
        referenceAt: new Date(Date.now() - 86400000).toISOString(),
        sourceUrl: "https://wcur.pma.ps/webtools/currency/embed",
        stale: false,
        source: "deterministic",
        observations: [
          "The change is indicative value, not guaranteed profit.",
        ],
      },
    });
  });
  await mountWalletFixture(page, "Currency%20Rates");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".demo-pill")).toHaveCount(0);
  await page.getByLabel("Insight amount").fill("500");
  await page.getByRole("button", { name: "Explain this conversion" }).click();
  await expect(
    page.getByRole("heading", { name: "₪1,800.00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/would get you ₪50.00 more than at/),
  ).toBeVisible();
  await expect(
    page.getByText("Calculated explanation · AI unavailable"),
  ).toBeVisible();
  await page.getByLabel("Insight amount").fill("600");
  await expect(
    page.getByRole("heading", { name: "₪1,800.00", exact: true }),
  ).toHaveCount(0);
});

test("a delayed preview cannot overwrite a changed conversion amount", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/conversions/preview", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        received: 35000,
        rate: 3500000,
        snapshotId: "fixture",
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    });
  });
  await mountWalletFixture(page, "Currency%20Rates");
  const response = page.waitForResponse("**/api/conversions/preview");
  await page.getByRole("button", { name: "Preview conversion" }).click();
  await page.getByLabel("Amount to convert").fill("200");
  release();
  await response;
  await expect(
    page.getByRole("button", { name: "Preview conversion" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Confirm simulated exchange" }),
  ).toHaveCount(0);
});
