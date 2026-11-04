import { test, expect } from "@playwright/test";
import { mountWalletFixture } from "./fixtures";
import type { Snapshot } from "../../shared/types";
const snapshot = (rate: number, stamp: number, id: string): Snapshot => ({
  id,
  publishedAt: new Date(stamp).toISOString(),
  fetchedAt: new Date(stamp).toISOString(),
  source: "https://twelvedata.com/forex",
  quotes: [],
  ils: { ILS: 1000000, USD: rate, JOD: Math.round(rate / 0.7) },
  market: {
    provider: "Twelve Data",
    timeKind: "minute quote",
    legs: [
      {
        symbol: "USD/ILS",
        rate,
        observedAt: new Date(stamp).toISOString(),
        marketOpen: true,
      },
      {
        symbol: "USD/JOD",
        rate: 700000,
        observedAt: new Date(stamp).toISOString(),
        marketOpen: true,
      },
    ],
  },
});
test("Forex widgets and stored history update automatically and recover after an outage", async ({
  page,
}) => {
  const stamp = Date.now();
  let count = 0,
    offline = false;
  const previous = snapshot(3400000, stamp - 60000, "before"),
    first = snapshot(3500000, stamp, "first"),
    second = snapshot(3600000, stamp + 30000, "second");
  await page.clock.install();
  await page.route("**/api/rates/live", (route) => {
    count++;
    return offline
      ? route.fulfill({ status: 503, json: { error: "provider unavailable" } })
      : route.fulfill({
          json: {
            snapshots: [previous, count === 1 ? first : second],
            status: {
              provider: "Twelve Data",
              configured: true,
              transport: "polling",
              pollMs: 60000,
              staleMs: 180000,
              connection: "connected",
            },
          },
        });
  });
  await page.route("**/api/rates/history?*", (route) =>
    route.fulfill({
      json: {
        snapshots:
          new URL(route.request().url()).searchParams.get("period") === "90d"
            ? []
            : [previous, count === 1 ? first : second],
      },
    }),
  );
  await mountWalletFixture(page, "Currency%20Rates");
  const pair = page.locator(".forex-pair").filter({
    has: page.getByRole("heading", { name: "USD/ILS", exact: true }),
  });
  await expect(pair.locator(".forex-value")).toHaveText("3.500000");
  await page.clock.fastForward(30000);
  await expect(pair.locator(".forex-value")).toHaveText("3.600000");
  await expect(
    page.getByRole("img", { name: "USD/ILS stored rate history" }),
  ).toBeVisible();
  offline = true;
  await page.clock.fastForward(30000);
  await expect(page.getByText(/Market connection unavailable/)).toBeVisible();
  offline = false;
  await page.clock.fastForward(60000);
  await expect(page.getByText("Rate updates connected")).toBeVisible();
  await page.getByLabel("History period").selectOption("90d");
  await expect(
    page.getByText(/No usable history for this period/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/forex-mobile.png",
    fullPage: true,
  });
});
