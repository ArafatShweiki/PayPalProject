import { test, expect } from "@playwright/test";
import { enterDemo, mountWalletFixture } from "./fixtures";
test("public information, searchable help, storage information and 404 work without login", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.startsWith("/api/"))
      privateRequests.push(req.url());
  });
  for (const path of [
    "/about",
    "/privacy-policy",
    "/terms-of-use",
    "/acceptable-use",
    "/cookie-policy",
    "/disclaimer",
    "/contact",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page).toHaveTitle(/Dream Piggy Bank/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/help");
  await page.getByLabel("Search help").fill("round-ups");
  await expect(
    page.getByRole("heading", {
      name: "Activate round-ups and edit savings settings",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Frequently asked questions" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/help-mobile.png",
    fullPage: true,
  });
  await page.goto("/storage-preferences");
  await page.getByText("Review necessary storage").click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Read the Cookie Policy" }),
  ).toBeVisible();
  await page.goto("/does-not-exist");
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Home" }).click();
  await expect(page).toHaveURL(/#Home$/);
  expect(privateRequests.filter((url) => !url.endsWith("/api/config"))).toEqual(
    [],
  );
});
test("demo retains savings/rates and exposes storage preferences", async ({
  page,
}) => {
  await enterDemo(page);
  await page
    .getByRole("link", { name: "Help Center", exact: true })
    .first()
    .click();
  await expect(page.locator("main h1")).toHaveText("Help Center");
  await page.getByRole("link", { name: "Back to app" }).click();
  await expect(
    page.getByRole("heading", { name: "Spending activity" }),
  ).toBeVisible();
  for (const name of ["Smart Savings", "Currency Rates", "Settings"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Storage preferences" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Exit Demo Mode", exact: true })
    .first()
    .click();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});
test("delayed private data displays skeletons and an enforced 429 offers recovery", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/state", async (route) => {
    await wait;
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Too many requests" }),
    });
  });
  // Register the isolated mount fixture first, then override its state response.
  await mountWalletFixture(page, "Home");
  await page.unroute("**/api/state");
  await page.route("**/api/state", async (route) => {
    await wait;
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Too many requests" }),
    });
  });
  await page.reload();
  await expect(page.getByLabel("Loading Home")).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Too many requests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again" }).first(),
  ).toBeEnabled({ timeout: 4000 });
});
