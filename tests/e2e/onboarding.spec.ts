import { test, expect } from "@playwright/test";

test("onboarding layout, validation and saved dashboard transition", async ({
  page,
}) => {
  // Render the actual boundary through Vite with a mocked authenticated API.
  // Real JWT validation and ownership are exercised in auth0-server.test.ts.
  await page.route("**/onboarding", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { OnboardingBoundary } = await import('/src/Onboarding.tsx');
      await import('/src/styles.css');
      createRoot(document.getElementById('root')).render(React.createElement(OnboardingBoundary, { onSignOut: () => {} }, React.createElement('h1', null, 'Protected dashboard')));
    </script></body></html>`,
    });
  });
  const profile = {
    complete: false,
    fullName: "Taylor Example",
    email: "taylor@example.com",
    emailVerified: true,
    preferred: "ILS",
    savings: "unseen",
    notifications: false,
  };
  await page.route("**/api/onboarding", (route) =>
    route.fulfill({
      json:
        route.request().method() === "PUT"
          ? { ...profile, ...route.request().postDataJSON(), complete: true }
          : profile,
    }),
  );
  await page.goto("/onboarding");
  await expect(page.getByLabel("Full name")).toHaveValue("Taylor Example");
  await expect(
    page.getByText("Verified by your sign-in provider."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Protected dashboard" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/onboarding-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/onboarding-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("Preferred currency").selectOption("JOD");
  await page.getByLabel("Not now", { exact: true }).check();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(
    page.getByRole("heading", { name: "Protected dashboard" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/#Home$/);
});
