import { expect, type Page } from "@playwright/test";
import { initialUser, balances } from "../../shared/ledger";
export async function enterDemo(
  page: Page,
  options: { sampleRates?: boolean } = { sampleRates: true },
) {
  await page.goto("/");
  const enter = page.getByRole("button", {
    name: "Explore Dream Piggy Bank (Demo Mode)",
  });
  const session = page.locator('[data-session="development-demo"]');
  await expect(enter.or(session).first()).toBeVisible();
  if (await enter.isVisible()) await enter.click();
  await expect(page.locator("[data-session=development-demo]")).toBeVisible();
  await page.getByRole("navigation").waitFor({ state: "attached" });
  if (options.sampleRates !== false) {
    const navigate = async (name: string) => {
      if (
        await page.getByRole("button", { name: "Open navigation" }).isVisible()
      )
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await navigate("Currency Rates");
    await page.getByLabel("Demo rate source").selectOption("sample");
    await navigate("Home");
  }
}
export function walletFixture() {
  const data = initialUser(true);
  return {
    ...data,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: [],
    authMode: "auth0",
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
}
// Existing asynchronous API UI tests mount App directly with controlled fixtures;
// they do not open an unauthenticated route in the actual application.
export async function mountWalletFixture(page: Page, hash: string) {
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: walletFixture() }),
  );
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { auth0: null, firebase: false } }),
  );
  await page.route("**/wallet-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { App } = await import('/src/App.tsx');
    await import('/src/styles.css');
    createRoot(document.getElementById('root')).render(React.createElement(App));
    </script></body></html>`,
    }),
  );
  await page.goto(`/wallet-test#${hash}`);
}
