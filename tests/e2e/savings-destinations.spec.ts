import { test, expect } from "@playwright/test";
import { CircleLedgerFixture } from "../fixtures/circle-ledger";
import { mountWalletFixture } from "./fixtures";
let ledger: CircleLedgerFixture;
test.beforeAll(async () => {
  ledger = new CircleLedgerFixture();
  await ledger.initialize();
});
test.afterAll(async () => {
  await ledger.db.close();
});
test("a pending first purchase requests a goal, permits an explicit no-round-up purchase, and saves subsequent ILS/JOD purchases to USD", async ({
  page,
}) => {
  const sub = await ledger.account("Pending setup");
  await ledger.db.exec("reset role");
  await ledger.db.query(
    "update profiles set savings_enabled=true where auth0_sub=$1",
    [sub],
  );
  await ledger.db.exec("set role service_role");
  await ledger.refresh();
  await mountWalletFixture(page, "My Wallet", ledger.states.get(sub)!);
  await page.route("**/api/**", (route) => ledger.route(sub, route));
  await page.reload();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Set up Smart Savings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Goal name")).toBeVisible();
  expect(ledger.states.get(sub)!.goals).toHaveLength(0);
  await modal
    .getByRole("button", { name: "Continue without a round-up" })
    .click();
  await expect(
    modal.getByText("No round-up will be deducted from this purchase."),
  ).toBeVisible();
  await modal
    .getByLabel("Merchant or description")
    .fill("Explicitly declined saving");
  await modal.getByLabel("Purchase amount").fill("16");
  await modal
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(modal).toHaveCount(0);
  expect(ledger.states.get(sub)!.balances.ILS).toBe(98400);
  expect(ledger.states.get(sub)!.savingsBalances.USD).toBe(0);
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  await expect(modal.getByLabel("Goal name")).toBeVisible();
  await modal.getByLabel("Goal name").fill("USD travel goal");
  await modal.getByLabel("currency", { exact: true }).selectOption("USD");
  await modal.getByLabel("Target amount").fill("100");
  await modal
    .getByRole("button", { name: "Create savings goal", exact: true })
    .click();
  await modal.getByLabel("Merchant or description").fill("ILS saving");
  await modal.getByLabel("Purchase amount").fill("16");
  await expect(modal.getByText(/\$1.14 credited/)).toBeVisible();
  await modal
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(modal).toHaveCount(0);
  expect(ledger.states.get(sub)!.savingsBalances.USD).toBe(114);
  await page
    .getByRole("button", { name: "Simulate purchase", exact: true })
    .click();
  await expect(modal.getByLabel("Goal name")).toHaveCount(0);
  await modal.getByLabel("Merchant or description").fill("JOD saving");
  await modal.getByLabel("currency", { exact: true }).selectOption("JOD");
  await modal.getByLabel("Purchase amount").fill("7.350");
  await expect(modal.getByText(/\$0.91 credited/)).toBeVisible();
  await modal
    .getByRole("button", { name: "Complete simulated purchase" })
    .click();
  await expect(modal).toHaveCount(0);
  expect(ledger.states.get(sub)!.savingsBalances.USD).toBe(205);
  expect(ledger.states.get(sub)!.goals).toHaveLength(1);
});
