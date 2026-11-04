import { test, expect } from "@playwright/test";
import { mountWalletFixture, walletFixture } from "./fixtures";
import type { Page } from "@playwright/test";

// Provider fixture: this exercises our SDK callbacks, not an actual PayPal payment.
async function mockCheckoutSdk(page: Page) {
  await page.route("https://www.sandbox.paypal.com/web-sdk/v6/core", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `customElements.define('paypal-button',class extends HTMLElement {
      static get observedAttributes(){return ['disabled'];}
      connectedCallback(){this.innerHTML='<button type="button">Continue to PayPal</button>';this.update();}
      attributeChangedCallback(){this.update();}
      update(){if(this.firstElementChild)this.firstElementChild.disabled=this.hasAttribute('disabled');}
    });
    window.paypal={createInstance:async()=>({findEligibleMethods:async(options)=>{window.lastEligibilityCurrency=options.currencyCode;return {isEligible:()=>true};},
      createPayPalOneTimePaymentSession:async(callbacks)=>({start:async(options,order)=>{
        const result=await order;
        if(window.checkoutOutcome==='cancel')await callbacks.onCancel();
        else if(window.checkoutOutcome==='error')callbacks.onError();
        else await callbacks.onApprove({orderId:result.orderId});
      }})})};`,
    }),
  );
}
test("one funding dialog handles empty wallets, unavailable funding, pending and completed test payments", async ({
  page,
}) => {
  const state = walletFixture();
  state.ledger = [];
  state.balances = { ILS: 0, USD: 0, JOD: 0 };
  state.savingsBalances = { ILS: 0, USD: 0, JOD: 0 };
  let available = false;
  const id = "10000000-0000-4000-8000-000000000001";
  let phase = "PENDING";
  await mockCheckoutSdk(page);
  await page.route("**/api/funding", (r) =>
    r.fulfill({
      json: {
        available,
        clientId: "public-checkout-fixture",
        currencies: ["USD", "ILS"],
        maxMinor: 500000,
        orders: available
          ? [
              {
                id,
                amount_minor: 5000,
                currency: "USD",
                status: phase,
                provider_order_id: "ORDER123",
                created_at: new Date().toISOString(),
              },
            ]
          : [],
      },
    }),
  );
  await page.route(
    new RegExp(`/api/funding/${id}/(?:capture|reconcile)$`),
    (r) => {
      phase = "COMPLETED";
      state.balances.USD = 5000;
      return r.fulfill({ json: { id, status: phase } });
    },
  );
  await mountWalletFixture(page, "Home", state);
  await page.getByRole("button", { name: "Add Funds", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByText(/Adding funds is currently unavailable/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to PayPal" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  available = true;
  await page.getByRole("button", { name: "My Wallet", exact: true }).click();
  await page.getByRole("button", { name: "Add Funds", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByText("PayPal checkout. Limit: $1.00–$5,000.00.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Funding currency").selectOption("ILS");
  await page.getByLabel("Funding amount").fill("1.001");
  await expect(
    page.getByRole("button", { name: "Continue to PayPal" }),
  ).toBeDisabled();
  await page.getByLabel("Funding currency").selectOption("USD");
  await page.getByLabel("Funding amount").fill("50.00");
  await expect(
    page.getByRole("button", { name: "Continue to PayPal" }),
  ).toBeEnabled();
  await expect(page.getByText(/PENDING/)).toBeVisible();
  await page.getByRole("button", { name: "Check payment status" }).click();
  await expect(page.getByText(/COMPLETED/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "$50.00", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const wallet = page.locator(".wallet-funding");
    const cards = await wallet.locator(".currency-grid").boundingBox();
    const button = await wallet
      .getByRole("button", { name: "Add Funds", exact: true })
      .boundingBox();
    const activity = await page
      .locator(".panel")
      .filter({
        has: page.getByRole("heading", {
          name: "Wallet activity",
          exact: true,
        }),
      })
      .boundingBox();
    expect(cards).not.toBeNull();
    expect(button).not.toBeNull();
    expect(activity).not.toBeNull();
    expect(button!.x).toBe(cards!.x);
    expect(button!.y - (cards!.y + cards!.height)).toBe(16);
    expect(activity!.y - (button!.y + button!.height)).toBe(24);
    await page.screenshot({
      path: `test-results/wallet-funding-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Add Funds", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/funding-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

for (const currency of ["USD", "ILS"] as const) {
  test(`SDK ${currency} approval uses backend capture, refreshes only that wallet, and cancellation or errors never credit`, async ({
    page,
  }) => {
    await mockCheckoutSdk(page);
    const state = walletFixture();
    const before = { ...state.balances };
    const id = "10000000-0000-4000-8000-000000000002";
    let credits = 0,
      cancels = 0;
    await page.route("**/api/funding", (route) =>
      route.fulfill({
        json: {
          available: true,
          clientId: "public-checkout-fixture",
          currencies: ["USD", "ILS"],
          maxMinor: 500000,
          orders: [],
        },
      }),
    );
    await page.route("**/api/funding/orders", (route) => {
      expect(route.request().postDataJSON().currency).toBe(currency);
      return route.fulfill({
        json: {
          id,
          status: "CREATED",
          provider_order_id: "ORDER123",
          currency,
          amount_minor: 100,
        },
      });
    });
    await page.route(`**/api/funding/${id}/capture`, (route) => {
      credits++;
      state.balances[currency] += 100;
      return route.fulfill({
        json: {
          id,
          status: "COMPLETED",
          currency,
          amount_minor: 100,
          capture_id: "CAPTURE123",
        },
      });
    });
    await page.route(`**/api/funding/${id}/cancel`, (route) => {
      cancels++;
      return route.fulfill({ json: { id, status: "CANCELED" } });
    });
    await mountWalletFixture(page, "My Wallet", state);
    await page.getByRole("button", { name: "Add Funds", exact: true }).click();
    await page.getByLabel("Funding currency").selectOption(currency);
    await expect(
      page.getByLabel("Funding currency").locator("option"),
    ).toHaveCount(2);
    await page.getByLabel("Funding amount").fill("1.00");
    await page.evaluate(() => {
      Object.assign(window, { checkoutOutcome: "cancel" });
    });
    await page.getByRole("button", { name: "Continue to PayPal" }).click();
    await expect(
      page.getByText("Checkout canceled. No funds were added."),
    ).toBeVisible();
    expect(cancels).toBe(1);
    expect(credits).toBe(0);
    await page.evaluate(() => {
      Object.assign(window, { checkoutOutcome: "error" });
    });
    await page.getByRole("button", { name: "Continue to PayPal" }).click();
    await expect(page.getByRole("alert")).toContainText("Check payment status");
    expect(credits).toBe(0);
    await page.evaluate(() => {
      Object.assign(window, { checkoutOutcome: "approve" });
    });
    await page.getByRole("button", { name: "Continue to PayPal" }).click();
    await expect(
      page.getByText(
        currency === "USD"
          ? /\$1.00 added to your wallet/
          : /₪1.00 added to your wallet/,
      ),
    ).toBeVisible();
    expect(credits).toBe(1);
    expect(state.balances).toEqual({
      ...before,
      [currency]: before[currency] + 100,
    });
  });
}

test("funding dialog omits conversion helpers without moving funds", async ({
  page,
}) => {
  const state = walletFixture();
  const before = { ...state.balances };
  await page.route("**/api/funding", (r) =>
    r.fulfill({
      json: {
        available: false,
        currencies: ["USD", "ILS"],
        orders: [],
        maxMinor: 500000,
      },
    }),
  );
  await mountWalletFixture(page, "Home", state);
  await page.getByRole("button", { name: "Add Funds", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      /Need JOD|Convert USD|test wallet balances|No real customer funds|Direct PayPal JOD|Funding uses/,
    ),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.balances).toEqual(before);
});

for (const currency of ["USD", "ILS"] as const) {
  test(`${currency} merchant rejection stays in the selected currency without capture or fallback`, async ({
    page,
  }) => {
    await mockCheckoutSdk(page);
    let attempts = 0,
      captures = 0;
    await page.route("**/api/funding", (r) =>
      r.fulfill({
        json: {
          available: true,
          clientId: "public-checkout-fixture",
          currencies: ["USD", "ILS"],
          maxMinor: 500000,
          orders: [],
        },
      }),
    );
    await page.route("**/api/funding/orders", (r) => {
      attempts++;
      expect(r.request().postDataJSON().currency).toBe(currency);
      return r.fulfill({
        status: 422,
        json: {
          error:
            "PayPal could not accept the selected currency for this payment. Check the receiving PayPal Business account currency preferences.",
        },
      });
    });
    await page.route("**/api/funding/*/capture", (r) => {
      captures++;
      return r.abort();
    });
    await mountWalletFixture(page, "My Wallet");
    await page.getByRole("button", { name: "Add Funds", exact: true }).click();
    await page.getByLabel("Funding currency").selectOption(currency);
    await page.getByLabel("Funding amount").fill("1.00");
    await expect(
      page.getByText(
        `PayPal checkout. Limit: ${currency === "USD" ? "$" : "₪"}1.00–${currency === "USD" ? "$" : "₪"}5,000.00.`,
        { exact: false },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue to PayPal" }).click();
    await expect(page.getByRole("alert")).toContainText("currency preferences");
    await expect(page.getByLabel("Funding currency")).toHaveValue(currency);
    expect(attempts).toBe(1);
    expect(captures).toBe(0);
  });
}
test("old browser flags cannot open financial pages or restore a local wallet", async ({
  page,
  request,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        auth0: {
          domain: "example.auth0.com",
          clientId: "public",
          databaseConnection: "database",
        },
        supabase: null,
      },
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "walletwise:developer-demo:v1",
      JSON.stringify({ data: { balances: { USD: 999999 } } }),
    );
    localStorage.setItem("VITE_ENABLE_DEMO_MODE", "true");
  });
  await page.goto("/?demo=true#My%20Wallet");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Explore Dream Piggy Bank|Add Funds/ }),
  ).toHaveCount(0);
  expect(
    (
      await request.post("/api/funding/orders", {
        headers: { "x-walletwise": "1" },
        data: {
          requestId: "10000000-0000-4000-8000-000000000001",
          currency: "USD",
          amount: "10.00",
        },
      })
    ).status(),
  ).toBe(401);
});
