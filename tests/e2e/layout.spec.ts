import { enterTestWallet } from "./fixtures";
import { test, expect } from "@playwright/test";
test("all seven pages render at desktop, laptop, tablet and mobile widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await enterTestWallet(page);
    await expect(page.getByText("Your money, in perspective.")).toBeVisible();
    for (const name of [
      "Home",
      "My Wallet",
      "Smart Savings",
      "Savings Circles",
      "Currency Rates",
      "Reports",
      "Settings",
    ]) {
      const menu = page.getByRole("button", { name: "Open navigation" });
      if (await menu.isVisible()) await menu.click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(
        /Auth0|Supabase|Firebase|Firestore|\bSandbox\b|schema-validated/i,
      );
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
  await enterTestWallet(page);
  await page.goto("/wallet-test#%E0%A4%A");
  await expect(page.getByText("Your money, in perspective.")).toBeVisible();
  expect(errors).toEqual([]);
});
test("Settings stays above Help and profile in the sidebar bottom on tall and short screens", async ({
  page,
}) => {
  await enterTestWallet(page);
  for (const [width, height] of [
    [1440, 1200],
    [820, 900],
    [390, 740],
    [390, 420],
    [1440, 450],
  ]) {
    await page.setViewportSize({ width, height });
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    const side = page.locator("aside.sidebar");
    await expect(side.locator(".workspace-links button")).toHaveText([
      "Home",
      "My Wallet",
      "Smart Savings",
      "Savings Circles",
      "Currency Rates",
      "Reports",
    ]);
    const bottom = side.locator(".sidebar-bottom"),
      settings = bottom.getByRole("button", { name: "Settings", exact: true });
    await side.locator("nav").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const s = (await settings.boundingBox())!,
      help = (await bottom
        .getByRole("link", { name: "Help Center" })
        .boundingBox())!,
      profile = (await bottom.locator(".profile").boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(help.y + 1);
    expect(help.y + help.height).toBeLessThanOrEqual(profile.y + 1);
    expect(profile.y + profile.height).toBeLessThanOrEqual(height + 1);
    if (height >= 900) expect(s.y).toBeGreaterThan(height / 2);
    await expect(
      bottom.getByRole("link", { name: "Help Center" }),
    ).toHaveAttribute("href", "/help");
    await settings.click();
    await expect(page).toHaveURL(/#Settings$/);
    await expect(page.getByLabel("Display name")).toBeVisible();
    if (width > 720) await expect(settings).toHaveClass("nav-item active");
    if (await menu.isVisible()) await menu.click();
    await expect(settings).toHaveAttribute("aria-current", "page");
    await side.screenshot({
      path: `test-results/sidebar-${width}-${height}.png`,
    });
    await bottom.locator(".profile").click();
    await expect(page).toHaveURL(/#Settings$/);
  }
});
