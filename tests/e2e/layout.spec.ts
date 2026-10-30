import { enterDemo } from "./fixtures";
import { test, expect } from "@playwright/test";
test("all six pages render at desktop, tablet and mobile widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await enterDemo(page);
    await expect(page.getByText("Your money, in perspective.")).toBeVisible();
    for (const name of [
      "Home",
      "My Wallet",
      "Smart Savings",
      "Currency Rates",
      "Reports",
      "Settings",
    ]) {
      if (width === 390)
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(
        /Auth0|Supabase|Firebase|Firestore|\bSandbox\b|schema-validated/i,
      );
      await expect(page.locator(".demo-pill")).toHaveCount(1);
      await expect(page.locator(".demo-pill")).toHaveText("Demo Mode");
      await expect(
        page.locator(".pill,.demo-pill").filter({ hasText: /simulat/i }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          /This is a simulated wallet|Simulated balances\. Real attention/,
        ),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name} fits ${width}px`,
      ).toBe(true);
      if (name === "Home" || name === "Smart Savings")
        await page.screenshot({
          path: `test-results/${name.replaceAll(" ", "-")}-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
    }
  }
  expect(errors).toEqual([]);
});

test("malformed navigation fragments fall back safely", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enterDemo(page);
  await page.goto("/#%E0%A4%A");
  await expect(page.getByText("Your money, in perspective.")).toBeVisible();
  expect(errors).toEqual([]);
});
