import { enterTestWallet } from "./fixtures";
import { test, expect } from "@playwright/test";
test("activate once, create a goal, purchase, report, approve a rule, refund, and persist settings", async ({
  page,
}) => {
  await enterTestWallet(page);
  await page
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  // Demo seed already has round-ups enabled.
  await expect(
    page.getByRole("button", { name: "Activate Smart Savings" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New savings goal" }).click();
  await page.getByLabel("Goal name").fill("New laptop");
  await page.getByLabel("Target amount").fill("1500");
  await page.getByLabel("Make this my default savings goal").check();
  await page
    .getByRole("button", { name: "Create savings goal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  await page.getByLabel("Merchant or description").fill("Corner coffee");
  await page
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("₪6,320.00")).toBeVisible();
  await page
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  await expect(
    page.locator("#selected-goal-details").getByText("₪1.60", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate report", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept rule" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept rule" }).first().click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator('input[name="increment-ILS"]')).toHaveValue(
    "10.00",
  );
  await page.getByLabel("Enable in-app currency notifications").uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await expect(
    page.getByLabel("Enable in-app currency notifications"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "My Wallet", exact: true }).click();
  await page.getByRole("button", { name: /^Corner coffee / }).click();
  await page.getByRole("button", { name: "Refund simulated purchase" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("₪6,345.00", { exact: true })).toBeVisible();
});
test("mobile navigation, persistent opt-out and server validation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterTestWallet(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel(
      "Automatically allocate round-ups after successful simulated purchases",
    )
    .uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Activate Smart Savings" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  await page.getByLabel("Merchant or description").fill("Too much");
  await page.getByLabel("Purchase amount").fill("999999");
  await page
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Insufficient");
  await expect(page.getByRole("dialog")).toBeVisible();
});
