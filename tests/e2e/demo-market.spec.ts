import { test, expect } from "@playwright/test";
import { enterDemo } from "./fixtures";
import type { Snapshot } from "../../shared/types";
const point = (rate: number, id: string): Snapshot => {
  const at = new Date().toISOString();
  return {
    id,
    publishedAt: at,
    fetchedAt: at,
    source: "https://twelvedata.com/forex",
    quotes: [],
    ils: { ILS: 1000000, USD: rate, JOD: Math.round(rate / 0.7) },
    market: {
      provider: "Twelve Data",
      timeKind: "minute quote",
      legs: [
        { symbol: "USD/ILS", rate, observedAt: at, marketOpen: true },
        { symbol: "USD/JOD", rate: 700000, observedAt: at, marketOpen: true },
      ],
    },
  };
};
const status = {
  provider: "Twelve Data",
  configured: true,
  connection: "connected",
  transport: "polling",
  pollMs: 60000,
  staleMs: 180000,
};
test("demo defaults to actual market reads, updates automatically and converts only simulated local money", async ({
  page,
}) => {
  let quote = point(3500000, "first");
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/api/market-data/") &&
      url.pathname !== "/api/config"
    )
      privateRequests.push(url.pathname);
  });
  await page.route("**/api/market-data/live", (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { snapshots: [quote], status } });
  });
  await page.route("**/api/market-data/history?*", (route) =>
    route.fulfill({ json: { snapshots: [quote] } }),
  );
  await page.clock.install();
  await enterDemo(page, { sampleRates: false });
  await page
    .getByRole("button", { name: "Currency Rates", exact: true })
    .click();
  await expect(page.getByLabel("Demo rate source")).toHaveValue("live");
  const pair = page.locator(".forex-pair").filter({
    has: page.getByRole("heading", { name: "USD/ILS", exact: true }),
  });
  await expect(pair.locator(".forex-value")).toHaveText("3.500000");
  await expect(pair.getByText("Direct provider quote")).toBeVisible();
  quote = point(3600000, "next");
  await page.clock.fastForward(30000);
  await expect(pair.locator(".forex-value")).toHaveText("3.600000");
  await page
    .getByRole("button", { name: "Preview conversion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm simulated exchange" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm simulated exchange" })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm simulated exchange" }),
  ).toHaveCount(0);
  expect(privateRequests).toEqual([]);
  await page
    .getByRole("button", { name: "Refresh rates", exact: true })
    .click();
  await expect(pair.locator(".forex-value")).toHaveText("3.600000");
  await expect(
    page.getByText("Rates checked.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/demo-real-forex.png",
    fullPage: true,
  });
});
test("unavailable real Forex never falls back until sample rates are explicitly selected", async ({
  page,
}) => {
  await page.route("**/api/market-data/live", (route) =>
    route.fulfill({
      json: {
        snapshots: [],
        status: {
          ...status,
          configured: false,
          connection: "unavailable",
          error: "TWELVE_DATA_API_KEY is missing",
        },
      },
    }),
  );
  await page.route("**/api/market-data/history?*", (route) =>
    route.fulfill({ json: { snapshots: [] } }),
  );
  await enterDemo(page, { sampleRates: false });
  await page
    .getByRole("button", { name: "Currency Rates", exact: true })
    .click();
  await expect(
    page.getByText(/Live currency rates are currently unavailable/),
  ).toBeVisible();
  await expect(page.getByText(/TWELVE_DATA_API_KEY/)).toHaveCount(0);
  await expect(page.locator(".forex-pair")).toHaveCount(0);
  await page.getByLabel("Demo rate source").selectOption("sample");
  await expect(
    page.getByRole("heading", { name: "Simulated exchange rates" }),
  ).toBeVisible();
  await expect(page.locator(".forex-pair")).toHaveCount(6);
  await page.getByLabel("Demo rate source").selectOption("live");
  await expect(page.locator(".forex-pair")).toHaveCount(0);
  await expect(
    page.getByText(/Live currency rates are currently unavailable/),
  ).toBeVisible();
});
