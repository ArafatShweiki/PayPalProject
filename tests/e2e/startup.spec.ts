import { test, expect } from "@playwright/test";
import { mountWalletFixture, walletFixture } from "./fixtures";
import { bootstrapFixture, loadingResponse } from "../fixtures/loading";
import type { State } from "../../shared/types";

test("verified balances and funding remain usable while charts/history are slow or unavailable", async ({
  page,
}) => {
  const state = walletFixture() as State;
  state.balances = { USD: 12345, ILS: 0, JOD: 0 };
  await page.route("**/api/rates/live", (r) =>
    r.fulfill({
      json: {
        snapshots: [],
        status: {
          provider: "PMA",
          configured: true,
          transport: "polling",
          pollMs: 300000,
          staleMs: 300000,
          connection: "connected",
        },
      },
    }),
  );
  await mountWalletFixture(page, "Home", state);
  await expect(page.getByLabel("Loading recent activity")).toHaveCount(0);
  let bootReads = 0,
    failOverview = true,
    release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/bootstrap", async (route) => {
    bootReads++;
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ json: bootstrapFixture(state) });
  });
  await page.route("**/api/dashboard?**", async (route) => {
    await wait;
    await route.fulfill(
      failOverview
        ? { status: 503, json: { error: "Temporarily unavailable" } }
        : { json: loadingResponse("/dashboard", state) },
    );
  });
  await page.route("**/api/activity?**", async (route) => {
    await wait;
    await route.fulfill({ json: loadingResponse("/activity", state) });
  });
  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByText("$123.45", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Loading recent activity")).toBeVisible();
  await expect(page.getByLabel("Loading monthly spending")).toBeVisible();
  expect(bootReads).toBe(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 700)
      await expect
        .poll(async () => {
          const box = await page.locator("aside.sidebar").boundingBox();
          return box ? box.x + box.width : 0;
        })
        .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `test-results/progressive-dashboard-${width}.png`,
      fullPage: true,
    });
  }
  release();
  await expect(
    page.getByText(/We couldn't load monthly spending/),
  ).toBeVisible();
  await expect(page.getByText("$123.45", { exact: true })).toBeVisible();
  failOverview = false;
  await page
    .getByRole("button", { name: "Try again", exact: true })
    .first()
    .click();
  await expect(page.getByText(/We couldn't load monthly spending/)).toHaveCount(
    0,
  );
  expect(bootReads).toBe(1);
});

test("essential network failures are bounded, recoverable and never displayed as zero balances", async ({
  page,
}) => {
  const state = walletFixture() as State;
  await mountWalletFixture(page, "Home", state);
  let failed = true,
    reads = 0;
  await page.route("**/api/bootstrap", async (route) => {
    reads++;
    if (failed) return route.abort("timedout");
    return route.fulfill({ json: bootstrapFixture(state) });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /temporarily unavailable/i }),
  ).toBeVisible();
  expect(reads).toBe(2);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(reads).toBe(3);
});
