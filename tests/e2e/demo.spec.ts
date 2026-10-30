import { test, expect } from "@playwright/test";
import { enterDemo } from "./fixtures";
test("demo actions stay local, survive refresh and clear on exit", async ({
  page,
  request,
}) => {
  const privateRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (
      (url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/config" &&
        !url.pathname.startsWith("/api/market-data/")) ||
      /supabase|paypal\.com/.test(url.hostname)
    )
      privateRequests.push(req.url());
  });
  await enterDemo(page);
  await expect(page).toHaveURL(/#Home$/);
  await expect(page.getByText("Demo Mode", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your profile" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill("Local demo developer");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue(
    "Local demo developer",
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  await page.getByLabel("Merchant or description").fill("Demo-only coffee");
  await page
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Currency Rates", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh simulated rates" }).click();
  await page.getByLabel("Insight amount").fill("500");
  await page.getByRole("button", { name: "Explain this conversion" }).click();
  await expect(page.getByText("Local calculations · no live AI")).toBeVisible();
  await page.getByLabel("Amount to convert").fill("10");
  await page.getByRole("button", { name: "Preview conversion" }).click();
  await page
    .getByRole("button", { name: "Confirm simulated exchange" })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm simulated exchange" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect(
    page.getByText("Calculated summary", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(privateRequests).toEqual([]);
  expect(errors).toEqual([]);
  // The frontend demo flag and forged demo cookie cannot authorize the server.
  expect(
    (
      await request.get("/api/state", {
        headers: { Cookie: `ww_session=${"a".repeat(64)}` },
      })
    ).status(),
  ).toBe(401);
  await page
    .getByRole("button", { name: "Exit Demo Mode", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Explore Dream Piggy Bank (Demo Mode)" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("walletwise:developer-demo:v1"),
    ),
  ).toBeNull();
  await page.reload();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Explore Dream Piggy Bank (Demo Mode)" })
    .click();
  await page.getByRole("button", { name: "My Wallet", exact: true }).click();
  await expect(page.getByText("Demo-only coffee", { exact: true })).toHaveCount(
    0,
  );
});
