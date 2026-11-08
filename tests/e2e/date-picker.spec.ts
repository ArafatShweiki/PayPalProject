import { test, expect } from "@playwright/test";
import { enterTestWallet } from "./fixtures";

test("wallet date picker supports keyboard selection, clearing and responsive positioning", async ({
  page,
}) => {
  await enterTestWallet(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "My Wallet", exact: true })
    .click();
  const from = page.getByRole("button", { name: /^From / });
  await from.click();
  const calendar = page.getByRole("dialog", { name: "From date", exact: true });
  await expect(calendar).toBeVisible();
  const focused = await page.locator(":focus").getAttribute("data-date");
  expect(focused).toBeTruthy();
  await page.keyboard.press("ArrowLeft");
  const chosen = await page.locator(":focus").getAttribute("data-date");
  expect(chosen).not.toBe(focused);
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(from).toBeFocused();
  await expect(from).not.toContainText("Select date");
  await from.click();
  await expect(calendar.locator('[aria-pressed="true"]')).toHaveAttribute(
    "data-date",
    chosen!,
  );
  await calendar.getByRole("button", { name: "Next month" }).click();
  await page.keyboard.press("Escape");
  await expect(from).toBeFocused();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await from.click();
    await expect(calendar).toBeVisible();
    await calendar.screenshot({
      path: `test-results/date-picker-${width}.png`,
    });
    const box = (await calendar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await calendar.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(from).toContainText("Select date");
  }
  await page.getByRole("button", { name: /^To / }).click();
  await page
    .getByRole("dialog", { name: "To date", exact: true })
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^To / })).not.toContainText(
    "Select date",
  );
});
