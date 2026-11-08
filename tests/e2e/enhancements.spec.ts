import { test, expect, type Page } from "@playwright/test";
import { buildCoach, type CoachInput } from "../../shared/coach";
import { mountWalletFixture, walletFixture } from "./fixtures";
function input(): CoachInput {
  return {
    asOf: "2026-11-06T12:00:00.000Z",
    goals: [
      {
        id: "laptop",
        name: "New Laptop",
        currency: "USD",
        target: 6000,
        saved: 3000,
        createdAt: "2026-10-09T12:00:00.000Z",
      },
    ],
    samples: ["2026-10-16", "2026-10-23", "2026-10-30"].map((at) => ({
      goalId: "laptop",
      at: at + "T12:00:00.000Z",
      amount: 1000,
      paceAmount: 1000,
    })),
    available: { ILS: 0, USD: 5000, JOD: 0 },
    guide: { dismissed: true, walletViewed: false, circlesViewed: false },
    steps: { funded: true, goal: true, enabled: true, purchased: true },
    spending: [
      {
        currency: "USD",
        category: "Food & drink",
        gross: 5000,
        refunds: 6500,
        net: -1500,
        previous: 1000,
        count: 3,
      },
    ],
  };
}
async function mount(page: Page, source: CoachInput, hash = "Smart Savings") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = walletFixture();
  state.ledger.push(
    ...source.samples.map((sample, i) => ({
      id: `sample-${i}`,
      at: sample.at,
      kind: "adjustment" as const,
      currency: "USD" as const,
      amount: sample.amount,
      saved: 0,
      description: "Recorded savings allocation",
      category: "Savings",
      goalId: sample.goalId,
      postings: [
        {
          currency: "USD" as const,
          account: "savings" as const,
          amount: sample.amount,
        },
        {
          currency: "USD" as const,
          account: "available" as const,
          amount: -sample.amount,
        },
      ],
    })),
  );
  state.preferences.savings = "disabled";
  state.goals = source.goals;
  state.dashboard = { dailySpending: [], goalTotals: { laptop: 3000 } };
  await page.route("**/api/savings/coach", (r) =>
    r.fulfill({ json: buildCoach(source) }),
  );
  await page.route("**/api/savings/options", (r) =>
    r.fulfill({
      json: {
        options: [],
        historical: { ILS: 0, USD: 0, JOD: 0 },
        destination: null,
        reconciliationRequired: false,
      },
    }),
  );
  await page.route("**/api/rates/live", (r) =>
    r.fulfill({
      json: {
        snapshots: [],
        status: { provider: "PMA", connection: "waiting", staleMs: 3600000 },
      },
    }),
  );
  await mountWalletFixture(page, hash, state);
}
test("coach distinguishes history, scenarios and provider failures across responsive widths", async ({
  page,
}) => {
  const source = input();
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() !== "GET")
      mutations.push(new URL(r.url()).pathname);
  });
  await page.route("**/api/savings/coach/explain", (r) =>
    r.fulfill({
      json: { ...buildCoach(source), explanationStatus: "unavailable" },
    }),
  );
  await mount(page, source);
  await expect(
    page.getByRole("heading", { name: "Your savings outlook" }),
  ).toBeVisible();
  await expect(
    page.locator(".coach-metrics").getByText("Dec 4, 2026", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Hypothetical weekly savings (USD)").fill("15.00");
  await expect(
    page.getByRole("status").filter({ hasText: "Nov 20, 2026" }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: "Explain with Gemini" }).click();
  await expect(page.getByText(/AI explanation is unavailable/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Where recorded spending goes" }),
  ).toBeVisible();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/enhancement-coach-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(mutations).toEqual(["/api/savings/coach/explain"]);
});
test("coach invalid scenario and insufficient history remain honest", async ({
  page,
}) => {
  const source = input();
  source.samples = [];
  await mount(page, source);
  await expect(
    page.getByText(
      "Not enough savings history to estimate a completion date yet.",
    ),
  ).toBeVisible();
  await page.getByLabel("Hypothetical weekly savings (USD)").fill("-10");
  await expect(page.getByRole("alert")).toContainText("Enter a weekly amount");
  await page.screenshot({
    path: "test-results/enhancement-coach-validation.png",
    fullPage: true,
  });
});
test("coach request failures preserve wallet navigation and offer recovery", async ({
  page,
}) => {
  const source = input();
  await mount(page, source, "Home");
  await page.route("**/api/savings/coach", (r) =>
    r.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry savings outlook" }),
  ).toBeVisible();
  await expect(page.locator(".wallet-hero")).toBeVisible();
  await page.route("**/api/savings/coach", (r) =>
    r.fulfill({ json: buildCoach(source) }),
  );
  await page.getByRole("button", { name: "Retry savings outlook" }).click();
  await expect(
    page.getByRole("button", { name: "Explore your outlook" }),
  ).toBeVisible();
});
test("optional guide skips persist and Help resume does not invent completion", async ({
  page,
}) => {
  const source = input();
  source.goals = [];
  source.samples = [];
  source.guide.dismissed = false;
  source.steps = {
    funded: false,
    goal: false,
    enabled: false,
    purchased: false,
  };
  await page.route("**/api/guide", async (r) => {
    Object.assign(source.guide, r.request().postDataJSON());
    await r.fulfill({ json: source.guide });
  });
  await mount(page, source, "Home");
  const guide = page.getByRole("region", { name: "Getting started guide" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("0 of 5 core steps complete");
  await guide.getByRole("button", { name: "Skip guide" }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(guide).toHaveCount(0);
  await page.goto("/wallet-test?guide=resume#Home");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("0 of 5 core steps complete");
  expect(page.url()).not.toContain("guide=resume");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/enhancement-guide-375.png",
    fullPage: true,
  });
});

test("completed goals and long names render without overflow or invented projections", async ({
  page,
}) => {
  const source = input();
  source.goals[0].saved = source.goals[0].target;
  source.goals[0].name =
    "A carefully planned family education and travel savings goal with a long descriptive name";
  source.samples.push({
    goalId: "laptop",
    at: source.asOf,
    amount: 3000,
    paceAmount: 3000,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await mount(page, source);
  await expect(page.getByText("Goal reached", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Hypothetical weekly savings (USD)"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/enhancement-completed-375.png",
    fullPage: true,
  });
});
