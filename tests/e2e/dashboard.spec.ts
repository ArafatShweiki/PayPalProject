import { test, expect } from "@playwright/test";
import { enterTestWallet } from "./fixtures";
test("bento charts, carousel controls and mobile reduced motion", async ({
  page,
}) => {
  await enterTestWallet(page);
  await expect(
    page.getByRole("heading", { name: "Spending activity" }),
  ).toBeVisible();
  await page.getByLabel("Trend currency pair").selectOption("USD/JOD");
  await expect(
    page.getByRole("img", { name: "USD/JOD stored rate history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View all", exact: true }).click();
  await expect(page).toHaveURL(/#My%20Wallet/);
  await page
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  const goals = page.locator(".carousel-goal");
  const count = await goals.count();
  await page.getByRole("button", { name: "Next goal", exact: true }).click();
  await expect(goals.nth(1)).toHaveAttribute("aria-pressed", "true");
  await goals.nth(1).focus();
  await page.keyboard.press("End");
  await expect(goals.last()).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Next goal", exact: true }).click();
  await expect(goals.first()).toHaveAttribute("aria-pressed", "true");
  expect(
    await goals.first().evaluate((el) => getComputedStyle(el).transform),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(goals).toHaveCount(count);
  await page.screenshot({
    path: "test-results/carousel-mobile-reduced-motion.png",
    fullPage: true,
  });
});

test("mouse dragging and native touch swipes inspect goals without changing destinations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterTestWallet(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Smart Savings", exact: true })
    .click();
  const rail = page.locator(".goal-carousel-rail");
  await rail.scrollIntoViewIfNeeded();
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".carousel-goal").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width * 0.85, y: box.y + 90 }],
  });
  for (let step = 1; step <= 8; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + box.width * 0.85 - step * 25, y: box.y + 90 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".carousel-goal").last()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".carousel-goal")).toHaveCount(3);
  await expect(page.locator("#selected-goal-details")).toContainText(
    "Learning fund",
  );
});
