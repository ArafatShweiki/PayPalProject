import { test, expect, type Page } from "@playwright/test";
import { CircleLedgerFixture } from "../fixtures/circle-ledger";
import { mountWalletFixture } from "./fixtures";
import { randomUUID } from "node:crypto";
import type { SavingsDestination } from "../../shared/circles";
let ledger: CircleLedgerFixture;
test.beforeAll(async () => {
  ledger = new CircleLedgerFixture();
  await ledger.initialize();
});
test.afterAll(async () => {
  await ledger.db.close();
});
async function mount(page: Page, sub: string) {
  await mountWalletFixture(page, "Smart Savings", ledger.states.get(sub)!);
  await page.route("**/api/**", (route) => ledger.route(sub, route));
  await page.reload();
}
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
async function deposit(page: Page, value: string) {
  await page.getByRole("button", { name: "Contribute", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Contribution amount").fill(value);
  await dialog.getByRole("button", { name: "Review contribution" }).click();
  await expect(dialog.getByText(/Circle funds are locked/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm contribution" }).click();
  await expect(dialog).toHaveCount(0);
}
test("switches a single persisted default between personal goals and Circles without moving existing funds", async ({
  page,
  browser,
}) => {
  const sub = await ledger.account("Destination switch");
  async function personal(name: string, makeDefault = false) {
    return ledger.rpc<{ id: string }>("walletwise_create_savings_goal", [
      sub,
      sub,
      randomUUID(),
      name,
      JSON.stringify({ name, currency: "USD", target: 10000 }),
      makeDefault,
    ]);
  }
  async function circle(name: string) {
    return ledger.rpc<{ id: string }>("walletwise_circle_command", [
      sub,
      "create",
      null,
      randomUUID(),
      JSON.stringify({ name, currency: "USD", target: 10000 }),
    ]);
  }
  const g1 = await personal("New Laptop", true),
    g2 = await personal("Travel fund"),
    c1 = await circle("Family Vacation"),
    c2 = await circle("New home");
  const q = await ledger.quote(sub, "USD", 200, { kind: "circle", id: c1.id });
  await ledger.rpc("walletwise_circle_contribute", [
    sub,
    c1.id,
    randomUUID(),
    "existing contribution",
    "USD",
    200,
    q.id,
    null,
  ]);
  ledger.states.set(sub, await ledger.read(sub));
  await mount(page, sub);
  const panel = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Savings destination",
      exact: true,
    }),
  });
  for (const [kind, id, name] of [
    ["circle", c1.id, "Family Vacation"],
    ["goal", g1.id, "New Laptop"],
    ["goal", g2.id, "Travel fund"],
    ["circle", c2.id, "New home"],
    ["circle", c1.id, "Family Vacation"],
    ["goal", g1.id, "New Laptop"],
  ] as const) {
    const before = structuredClone({
      wallet: ledger.states.get(sub)!.balances,
      savings: ledger.states.get(sub)!.savingsBalances,
      entries: ledger.states.get(sub)!.circleEntries,
    });
    if (kind === "goal" && id === g1.id) {
      await page
        .getByRole("button", { name: "Inspect New Laptop", exact: true })
        .click();
      // A personal goal must have a visible save action, outside the collapsed menu.
      await page
        .getByRole("button", {
          name: "Set as default savings goal",
          exact: true,
        })
        .click();
    } else {
      await page.getByRole("button", { name: "Choose savings goal" }).click();
      const modal = page.getByRole("dialog");
      await expect(modal.getByRole("option")).toHaveCount(5);
      await modal
        .getByLabel("Default savings destination")
        .selectOption(`${kind}:${id}`);
      await modal.getByRole("button", { name: "Use this goal" }).click();
      await expect(modal).toHaveCount(0);
    }
    await expect(panel).toContainText(`${name} · USD`);
    await expect
      .poll(() => ledger.states.get(sub)!.preferences.savingsDestination)
      .toEqual({ kind, id, currency: "USD" });
    const current = ledger.states.get(sub)!;
    expect({
      wallet: current.balances,
      savings: current.savingsBalances,
      entries: current.circleEntries,
    }).toEqual(before);
    await page.reload();
    await expect(panel).toContainText(`${name} · USD`);
  }
  await page.route("**/api/savings/destination", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Unable to save destination. Please try again." },
    }),
  );
  await page.getByRole("button", { name: "Choose savings goal" }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Default savings destination")
    .selectOption(`circle:${c2.id}`);
  await modal.getByRole("button", { name: "Use this goal" }).click();
  await expect(modal.getByRole("alert")).toContainText(
    "Unable to save destination",
  );
  expect(ledger.states.get(sub)!.preferences.savingsDestination?.id).toBe(
    g1.id,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(panel).toContainText("New Laptop · USD");
  const context = await browser.newContext(),
    returning = await context.newPage();
  await mount(returning, sub);
  await expect(
    returning.getByText("New Laptop · USD", { exact: true }),
  ).toBeVisible();
  await navigate(returning, "My Wallet");
  await returning
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  const purchase = returning.getByRole("dialog");
  await purchase
    .getByLabel("Merchant or description")
    .fill("New destination purchase");
  await purchase.getByLabel("Purchase amount").fill("16");
  await expect(purchase.getByText(/\$1.14 credited/)).toBeVisible();
  await purchase
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(purchase).toHaveCount(0);
  expect(ledger.states.get(sub)!.savingsBalances.USD).toBe(114);
  const circles = await ledger.rpc<{ id: string; balance: string }[]>(
    "walletwise_circles",
    [sub, null],
  );
  expect(circles.find((c) => c.id === c1.id)!.balance).toBe("200");
  expect(circles.find((c) => c.id === c2.id)!.balance).toBe("0");
  expect(ledger.states.get(sub)!.preferences.savingsDestination).toEqual({
    kind: "goal",
    id: g1.id,
    currency: "USD",
  } satisfies SavingsDestination);
  await context.close();
});
test("goal setup, ILS to USD saving, direct invitation, two-member voting and locked transfer use real SQL", async ({
  page,
  browser,
}) => {
  const alice = await ledger.account("Alice"),
    bob = await ledger.account("Bob");
  await mount(page, alice);
  await page.getByRole("button", { name: "Choose savings goal" }).click();
  const setup = page.getByRole("dialog");
  await expect(setup.getByLabel("Goal name")).toBeVisible();
  await setup.getByLabel("Goal name").fill("Personal trip");
  await setup.getByLabel("currency", { exact: true }).selectOption("USD");
  await setup.getByLabel("Target amount").fill("100");
  await setup
    .getByRole("button", { name: "Create savings goal", exact: true })
    .click();
  await expect(setup).toHaveCount(0);
  await navigate(page, "My Wallet");
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  const purchase = page.getByRole("dialog");
  await purchase.getByLabel("Merchant or description").fill("Coffee");
  await purchase.getByLabel("Purchase amount").fill("16");
  await expect(purchase.getByText(/\$1.14 credited/)).toBeVisible();
  await purchase
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(purchase).toHaveCount(0);
  expect(ledger.states.get(alice)!.savingsBalances.USD).toBe(114);
  expect(ledger.states.get(alice)!.balances.ILS).toBe(98000);
  await navigate(page, "Savings Circles");
  await page
    .getByRole("button", { name: "Create Circle", exact: true })
    .click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Circle name").fill("Family trip");
  await create.getByLabel("currency", { exact: true }).selectOption("USD");
  await create.getByLabel("Target amount").fill("100");
  await create
    .getByRole("button", { name: "Create Circle", exact: true })
    .click();
  await expect(create).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Family trip", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite Members", exact: true })
    .click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/circles\/invite\/[A-Za-z0-9_-]{43}$/);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole("button", { name: "Copy Link", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Copy failed. Select and copy the link manually."),
  ).toBeVisible();
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy Link", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const context = await browser.newContext(),
    member = await context.newPage();
  await mount(member, bob);
  await member.evaluate(
    (path) => history.replaceState({}, "", path),
    new URL(link).pathname,
  );
  // The application router is mounted by the same test-only harness on this path.
  await member.route(
    "http://127.0.0.1:5187/circles/invite/*",
    async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const {React,createRoot}=await import('/tests/fixtures/browser.tsx');const {setAuth0TokenProvider}=await import('/src/api.ts');setAuth0TokenProvider(async()=>"test-fixture-token");const {App}=await import('/src/App.tsx');await import('/src/styles.css');createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`,
      });
    },
  );
  await member.goto(link);
  await expect(
    member.getByRole("heading", { name: "Join Family trip" }),
  ).toBeVisible();
  await member
    .getByRole("button", { name: "Join Circle", exact: true })
    .click();
  await expect(
    member.getByRole("heading", { name: "Family trip", exact: true }),
  ).toBeVisible();
  // Reopening the invitation must recognize the membership without joining again.
  await member.goto(link);
  await expect(
    member.getByText("You're already in this circle."),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: "Join Circle", exact: true }),
  ).toHaveCount(0);
  await member
    .getByRole("button", { name: "Open Circle", exact: true })
    .click();
  await expect(
    member.getByRole("heading", { name: "Family trip", exact: true }),
  ).toBeVisible();
  await deposit(member, "2.00");
  await page.getByRole("button", { name: "Refresh Circle" }).click();
  await deposit(page, "1.00");
  await page.getByRole("button", { name: "Use for Smart Savings" }).click();
  await navigate(page, "My Wallet");
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  const automatic = page.getByRole("dialog");
  await automatic.getByLabel("Merchant or description").fill("Circle coffee");
  await automatic.getByLabel("Purchase amount").fill("16");
  await expect(
    automatic.getByText(/\$1.14 credited to your Savings Circle/),
  ).toBeVisible();
  await automatic
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(automatic).toHaveCount(0);
  await page.getByRole("button", { name: /^Circle coffee/ }).click();
  await expect(
    automatic.getByText(/Circle contribution stays locked/),
  ).toBeVisible();
  await automatic.getByRole("button", { name: "Refund purchase only" }).click();
  await expect(automatic).toHaveCount(0);
  await navigate(page, "Savings Circles");
  await page.getByRole("button", { name: /Family trip/ }).click();
  await page
    .getByRole("button", { name: "Request Withdrawal", exact: true })
    .click();
  const request = page.getByRole("dialog");
  await request.getByLabel("Withdrawal amount (USD)").fill("1.00");
  await request.getByLabel("Reason").fill("Shared trip booking");
  await request.getByRole("button", { name: "Review request" }).click();
  await request
    .getByRole("button", { name: "Submit approval request" })
    .click();
  await expect(request).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("Request locked — 1 of 2 approvals"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execute approved request" }),
  ).toHaveCount(0);
  await member.getByRole("button", { name: "Refresh Circle" }).click();
  await member.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Refresh Circle" }).click();
  await page.getByRole("button", { name: "Execute approved request" }).click();
  await expect(
    page.locator(".circle-proposal").getByText("Completed", { exact: true }),
  ).toBeVisible();
  const circles = await ledger.rpc<{ id: string }[]>("walletwise_circles", [
    alice,
  ]);
  const result = await ledger.rpc<{
    balance: string;
    members: { share: string }[];
  }>("walletwise_circles", [alice, circles[0].id]);
  expect(result.balance).toBe("314");
  expect(result.members.reduce((s, m) => s + Number(m.share), 0)).toBe(314);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/circles-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await context.close();
});
