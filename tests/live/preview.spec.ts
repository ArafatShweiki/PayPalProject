import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { missingPreview, safeSend } from "./environment";
import { origin, PRODUCTION_ORIGIN, SafetyError } from "./safety";
import { PreviewHarness } from "./preview-harness";
import { guardContext } from "./fixtures";
import type {
  State,
  Entry,
  Report,
  OnboardingStatus,
} from "../../shared/types";
import type { SavingsOptions } from "../../shared/circles";

// Reject a production target during collection, even when other variables are missing.
if (
  process.env.LIVE_PREVIEW_ORIGIN &&
  origin(process.env.LIVE_PREVIEW_ORIGIN) === PRODUCTION_ORIGIN
)
  throw new SafetyError();
const missing = missingPreview();
let h: PreviewHarness;
let goals: string[] = [],
  circles: string[] = [];
const funded = () =>
  test.skip(
    process.env.LIVE_ALLOW_TEST_FIXTURE_FUNDS !== "true",
    "BLOCKED: isolated balanced test funding must be explicitly enabled.",
  );
const minor = (value: string) => BigInt(value);
const state = () => h.ok<State>(h.actors[0], "GET", "/api/state");

test.describe("isolated deployed frontend, API and PostgreSQL", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    missing.length > 0,
    "BLOCKED: no isolated Preview, test database and two authorized Auth0 accounts configured.",
  );
  test.beforeAll(async ({ browser }) => {
    h = new PreviewHarness(browser);
    await h.prepare();
  });
  test.afterAll(async ({}, info) => {
    if (!h?.actors.length) return;
    try {
      await h.close();
    } finally {
      await info.attach("safe-network-summary", {
        body: JSON.stringify({
          api: h.events,
          violations: h.safety.violations,
          consoleErrors: h.safety.consoleErrors,
          failures: h.safety.failures,
        }),
        contentType: "application/json",
      });
      await info.attach("cleanup-summary", {
        body: JSON.stringify(h.cleanup),
        contentType: "application/json",
      });
      for (const actor of h.actors) {
        const path = `.temp/live-state/${h.run}-${actor.alias}-redacted.zip`;
        if (existsSync(path))
          await info.attach(`redacted-trace-${actor.alias}`, {
            path,
            contentType: "application/zip",
          });
      }
    }
    expect(
      h.safety.violations.length,
      "No unauthorized request may leave the browser",
    ).toBe(0);
    expect(
      h.safety.consoleErrors.length,
      "Unexpected browser console errors; text withheld",
    ).toBe(0);
    expect(
      h.safety.failures.length,
      "Unexpected critical browser requests failed",
    ).toBe(0);
    expect(
      h.cleanup.unresolved.filter((s) => !s.startsWith("Unused/consumed"))
        .length,
      "Resource cleanup must succeed; private recovery journal retained locally",
    ).toBe(0);
  });
  test.afterEach(async ({}, info) => {
    if (!h) return;
    if (info.status !== info.expectedStatus)
      for (const actor of h.actors) {
        const file = info.outputPath(`private-page-${actor.alias}.png`);
        // Full mask also covers third-party login pages and account navigation.
        await actor.page
          .screenshot({ path: file, mask: [actor.page.locator("body")] })
          .then(() =>
            info.attach(`private-page-${actor.alias}`, {
              path: file,
              contentType: "image/png",
            }),
          )
          .catch(() => undefined);
      }
    expect(h.safety.violations.length).toBe(0);
  });
  test("real Auth0 callback verifies two distinct RS256 identities", async () => {
    expect(h.actors.length).toBe(2);
    expect(h.actors[0].sub === h.actors[1].sub).toBe(false);
    for (const actor of h.actors)
      expect(new URL(actor.page.url()).origin === h.target.origin).toBe(true);
  });
  test("first-time onboarding completes; returning profiles stay stable", async () => {
    for (const actor of h.actors) {
      if (!actor.onboarding.complete) {
        actor.onboarding = await h.ok<OnboardingStatus>(
          actor,
          "PUT",
          "/api/onboarding",
          {
            fullName: `QA actor ${actor.alias}`,
            email: process.env[`LIVE_USER_${actor.alias}_EMAIL`],
            preferred: "USD",
            savings: "disabled",
            notifications: false,
          },
        );
      }
      expect(actor.onboarding.complete).toBe(true);
      const reread = await h.ok<OnboardingStatus>(
        actor,
        "GET",
        "/api/onboarding",
      );
      expect(reread.complete).toBe(true);
      expect(reread.fullName === actor.onboarding.fullName).toBe(true);
      await actor.page.reload();
      await expect(
        actor.page.getByRole("button", {
          name: "Continue with email",
          exact: true,
        }),
      ).toHaveCount(0);
    }
  });
  test("isolated balanced funding fixture and three-currency ledger reconcile", async () => {
    funded();
    await h.seed();
    for (const actor of h.actors) await h.ledger(actor);
  });
  test("all authenticated pages refresh at four viewport widths", async ({}, info) => {
    for (const width of [375, 768, 1024, 1440]) {
      const page = h.actors[0].page;
      await page.setViewportSize({ width, height: 1000 });
      for (const section of [
        "Home",
        "My Wallet",
        "Smart Savings",
        "Savings Circles",
        "Currency Rates",
        "Reports",
        "Settings",
      ]) {
        await page.goto(`${h.target.origin}/#${encodeURIComponent(section)}`);
        await expect(page.locator("main")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement !== document.body),
      ).toBe(true);
      if (width === 1440) {
        const settings = await page
          .locator(".sidebar-bottom")
          .getByRole("button", { name: "Settings", exact: true })
          .boundingBox();
        const help = await page
          .locator(".sidebar-bottom")
          .getByRole("link", { name: "Help Center", exact: true })
          .boundingBox();
        expect(
          !!settings && !!help && settings.y + settings.height <= help.y + 1,
        ).toBe(true);
      }
      // Never attach private balances/identities; public layout screenshots are in smoke.
    }
    await info.attach("responsive-viewports", {
      body: "375, 768, 1024, 1440; authenticated contents withheld",
      contentType: "text/plain",
    });
  });
  test("wallet currencies, account isolation and saved preferences", async () => {
    const a = await state();
    const b = await h.ok<State>(h.actors[1], "GET", "/api/state");
    expect(Object.keys(a.balances).sort()).toEqual(["ILS", "JOD", "USD"]);
    expect(a.auth0Sub === h.actors[0].sub).toBe(true);
    expect(b.auth0Sub === h.actors[1].sub).toBe(true);
    await h.ok(h.actors[0], "PUT", "/api/preferences", { preferred: "JOD" });
    expect((await state()).preferences.preferred).toBe("JOD");
    for (const actor of h.actors) await h.ledger(actor);
  });
  test("goal and Circle creation validate input and ownership", async () => {
    expect(
      (
        await h.call(h.actors[0], "POST", "/api/goals", {
          requestId: h.id("invalid-goal"),
          name: "",
          currency: "USD",
          amount: "0",
        })
      ).status,
    ).toBe(400);
    goals = [
      await h.goal(h.actors[0], "one", "USD"),
      await h.goal(h.actors[0], "two", "ILS"),
    ];
    circles = [
      await h.circle(h.actors[0], "one"),
      await h.circle(h.actors[0], "two"),
    ];
    for (const id of circles) {
      const detail = await h.detail(h.actors[0], id);
      expect(detail.owner).toBe(true);
      expect(minor(detail.balance)).toBe(0n);
      expect(
        (await h.call(h.actors[1], "GET", `/api/circles/${id}`)).status,
      ).toBe(404);
    }
  });
  test("all four default destination switches leave old contributions unchanged", async () => {
    const before = await Promise.all(
      circles.map((id) => h.detail(h.actors[0], id)),
    );
    for (const destination of [
      { kind: "goal", id: goals[0] },
      { kind: "goal", id: goals[1] },
      { kind: "circle", id: circles[0] },
      { kind: "circle", id: circles[1] },
      { kind: "goal", id: goals[0] },
    ]) {
      await h.ok(h.actors[0], "PUT", "/api/savings/destination", {
        ...destination,
        enable: true,
      });
      const options = await h.ok<SavingsOptions>(
        h.actors[0],
        "GET",
        "/api/savings/options",
      );
      expect(options.destination?.id === destination.id).toBe(true);
    }
    const after = await Promise.all(
      circles.map((id) => h.detail(h.actors[0], id)),
    );
    expect(
      after.every(
        (d, i) =>
          d.balance === before[i].balance &&
          d.entries.length === before[i].entries.length,
      ),
    ).toBe(true);
  });
  test("purchase validation rejects invalid, negative, zero and insufficient funds", async () => {
    for (const amount of ["abc", "0", "-1", "999999999.00"]) {
      const result = await h.call(h.actors[0], "POST", "/api/purchases", {
        requestId: h.id(`invalid-purchase:${amount}`),
        currency: "USD",
        amount,
        description: "QA validation",
        category: "Other",
        skipSavings: true,
      });
      expect(result.status >= 400 && result.status < 500).toBe(true);
    }
    await h.ledger(h.actors[0]);
  });
  test("same-currency purchase and refund replay credit exactly once", async () => {
    funded();
    const actor = h.actors[0],
      before = await h.balances(actor);
    const body = {
      requestId: h.id("purchase"),
      currency: "USD",
      amount: "1.10",
      description: `QA ${h.run}`,
      category: "Other",
      skipSavings: true,
    };
    const entry = await h.ok<Entry>(actor, "POST", "/api/purchases", body);
    await h.ok(actor, "POST", "/api/purchases", body);
    expect((await h.balances(actor)).USD).toBe(before.USD - 110);
    await h.ledger(actor);
    const foreign = await h.call(h.actors[1], "POST", "/api/refunds", {
      requestId: h.id("foreign-refund"),
      id: entry.id,
    });
    expect(foreign.status >= 400 && foreign.status < 500).toBe(true);
    const refund = { requestId: h.id("refund"), id: entry.id };
    await h.ok(actor, "POST", "/api/refunds", refund);
    await h.ok(actor, "POST", "/api/refunds", refund);
    expect((await h.balances(actor)).USD).toBe(before.USD);
    await h.ledger(actor);
  });
  for (const [currency, index] of [
    ["ILS", 0],
    ["USD", 1],
    ["JOD", 0],
  ] as const)
    test(`${currency} purchase converts only savings into destination currency`, async () => {
      funded();
      const actor = h.actors[0],
        destination = { kind: "goal" as const, id: goals[index] };
      await h.ok(actor, "PUT", "/api/savings/destination", {
        ...destination,
        enable: true,
      });
      const before = await h.balances(actor),
        amount = currency === "JOD" ? "1.101" : "1.10",
        merchant = currency === "JOD" ? 1101 : 110;
      const quote = await h.quote(actor, currency, amount, destination, true);
      expect(quote.quote.source_currency).toBe(currency);
      expect(quote.quote.source_minor > 0).toBe(true);
      expect(quote.quote.target_minor > 0 && quote.quote.rate_units > 0).toBe(
        true,
      );
      const transaction = await h.ok<{ id: string }>(
        actor,
        "POST",
        "/api/purchases",
        {
          requestId: h.id(`fx-purchase:${currency}`),
          currency,
          amount,
          description: "QA FX purchase",
          category: "Other",
          quoteId: quote.quote.id,
          skipSavings: false,
        },
      );
      // The mutation returns a raw SQL transaction; the mapped API ledger is the
      // authority for displayed merchant amount and savings quote metadata.
      const entry = (await state()).ledger.find(
        (e) => e.id === transaction.id,
      )!;
      expect(!!entry).toBe(true);
      expect(entry.currency).toBe(currency);
      expect(entry.amount).toBe(merchant);
      expect((await h.balances(actor))[currency]).toBe(
        before[currency] - merchant - quote.quote.source_minor,
      );
      expect(entry.saving?.target_minor).toBe(quote.quote.target_minor);
      await h.ledger(actor);
      await h.ok(actor, "POST", "/api/refunds", {
        requestId: h.id(`fx-refund:${currency}`),
        id: entry.id,
      });
      await h.ledger(actor);
    });
  test("direct invitation uses Preview domain; explicit join is idempotent", async () => {
    const invitation = await h.ok<{ url: string }>(
      h.actors[0],
      "POST",
      `/api/circles/${circles[0]}/invite`,
      { requestId: h.id("invite") },
    );
    const url = new URL(invitation.url);
    expect(url.origin === h.target.origin).toBe(true);
    const token = url.pathname.split("/").at(-1)!;
    const preview = await safeSend(
      h.target,
      "GET",
      `/api/circles/invite/${token}`,
    );
    expect(preview.status).toBe(200);
    const visitor = await h.actors[0].context.browser()!.newContext({
      serviceWorkers: "block",
      storageState: { cookies: [], origins: [] },
    });
    try {
      await guardContext(visitor, h.target, h.safety);
      const page = await visitor.newPage();
      await page.goto(url.href);
      await expect(page.locator(".auth-card .circle-invitation")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Continue with email", exact: true }),
      ).toBeVisible();
      expect(
        (await h.detail(h.actors[0], circles[0])).members.filter(
          (m) => m.active,
        ).length,
      ).toBe(1);
    } finally {
      await visitor.close();
    }
    const body = { requestId: h.id("join"), token };
    await h.ok(h.actors[1], "POST", "/api/circles/join", body);
    await h.ok(h.actors[1], "POST", "/api/circles/join", body);
    expect(
      (await h.detail(h.actors[0], circles[0])).members.filter((m) => m.active)
        .length,
    ).toBe(2);
    await h.action(h.actors[0], circles[0], "revoke", { action: "revoke" });
    expect(
      (await safeSend(h.target, "GET", `/api/circles/invite/${token}`)).status,
    ).toBe(404);
  });
  test("two contributors, duplicate and concurrent requests reconcile shares", async () => {
    funded();
    const id = circles[0];
    const first = await h.contribution(h.actors[0], id, "owner");
    const before = await h.detail(h.actors[0], id);
    await Promise.all([
      h.ok(h.actors[0], "POST", `/api/circles/${id}/contribute`, first.body),
      h.ok(h.actors[0], "POST", `/api/circles/${id}/contribute`, first.body),
    ]);
    expect((await h.detail(h.actors[0], id)).balance === before.balance).toBe(
      true,
    );
    await h.contribution(h.actors[1], id, "member");
    const detail = await h.detail(h.actors[0], id);
    expect(
      detail.members.reduce((sum, m) => sum + minor(m.share), 0n) ===
        minor(detail.balance),
    ).toBe(true);
    for (const actor of h.actors) await h.ledger(actor);
  });
  test("unanimous approval locks funds until both contributors approve; replay moves once", async () => {
    funded();
    const [owner, member] = h.actors,
      id = circles[0],
      before = await h.detail(owner, id);
    const proposalId = await h.propose(
      owner,
      id,
      "withdraw",
      "withdraw",
      "1.00",
    );
    await h.action(owner, id, "owner-approve", {
      action: "vote",
      proposalId,
      decision: "Approve",
    });
    const premature = await h.call(
      owner,
      "POST",
      `/api/circles/${id}/actions`,
      { requestId: h.id("premature"), action: "execute", proposalId },
    );
    expect(premature.status >= 400 && premature.status < 500).toBe(true);
    expect((await h.detail(owner, id)).balance === before.balance).toBe(true);
    await h.action(member, id, "member-approve", {
      action: "vote",
      proposalId,
      decision: "Approve",
    });
    const execute = {
      requestId: h.id("execute"),
      action: "execute",
      proposalId,
    };
    await h.ok(owner, "POST", `/api/circles/${id}/actions`, execute);
    const after = await h.detail(owner, id);
    await h.ok(owner, "POST", `/api/circles/${id}/actions`, execute);
    expect((await h.detail(owner, id)).balance === after.balance).toBe(true);
    expect(minor(before.balance) - minor(after.balance)).toBe(100n);
    for (const actor of h.actors) await h.ledger(actor);
  });
  test("rejection and forged ownership cannot execute group transfers", async () => {
    funded();
    const [owner, member] = h.actors,
      id = circles[0];
    const proposalId = await h.propose(owner, id, "reject", "withdraw", "1.00");
    await h.action(member, id, "reject-vote", {
      action: "vote",
      proposalId,
      decision: "Reject",
    });
    const result = await h.call(owner, "POST", `/api/circles/${id}/actions`, {
      requestId: h.id("rejected-execute"),
      action: "execute",
      proposalId,
    });
    expect(result.status >= 400 && result.status < 500).toBe(true);
    const forged = await h.call(
      member,
      "POST",
      `/api/circles/${circles[1]}/actions`,
      { requestId: h.id("forged"), action: "archive", memberId: "forged" },
    );
    expect(forged.status >= 400 && forged.status < 500).toBe(true);
    for (const actor of h.actors) await h.ledger(actor);
  });
  test("conversion quote expires, then valid conversion commits idempotently", async () => {
    funded();
    const actor = h.actors[0],
      input = { from: "USD", to: "ILS", amount: "1.00" };
    const quote = await h.ok<{
      snapshotId: string;
      rate: number;
      expiresAt: string;
    }>(actor, "POST", "/api/conversions/preview", input);
    const expired = await h.call(actor, "POST", "/api/conversions", {
      ...input,
      ...quote,
      requestId: h.id("expired-conversion"),
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(expired.status >= 400 && expired.status < 500).toBe(true);
    const current = await h.ok<typeof quote>(
      actor,
      "POST",
      "/api/conversions/preview",
      input,
    );
    const body = { ...input, ...current, requestId: h.id("conversion") };
    await h.ok(actor, "POST", "/api/conversions", body);
    const after = await h.balances(actor);
    await h.ok(actor, "POST", "/api/conversions", body);
    expect(
      JSON.stringify(await h.balances(actor)) === JSON.stringify(after),
    ).toBe(true);
    await h.ledger(actor);
  });
  test("weekly/monthly saved reports preserve periods and deterministic totals", async () => {
    for (const frequency of ["weekly", "monthly"]) {
      const actor = h.actors[0],
        before = await h.balances(actor);
      const report = await h.ok<Report>(actor, "POST", "/api/reports", {
        frequency,
        timezone: "Asia/Hebron",
      });
      expect(report.frequency).toBe(frequency);
      expect(report.timezone).toBe("Asia/Hebron");
      expect(Date.parse(report.since) < Date.parse(report.until!)).toBe(true);
      expect(
        report.summaries.every(
          (s) =>
            Number.isSafeInteger(s.spending) && Number.isSafeInteger(s.savings),
        ),
      ).toBe(true);
      const persisted = await state();
      expect(persisted.reports.some((r) => r.id === report.id)).toBe(true);
      const cutoff = Math.min(Date.parse(report.until!), Date.parse(report.at));
      const refunded = new Set(
        persisted.ledger
          .filter(
            (e) =>
              (e.kind === "refund" || e.kind === "reversal") &&
              Date.parse(e.at) < cutoff,
          )
          .map((e) => e.originalId),
      );
      for (const summary of report.summaries) {
        const expected = persisted.ledger
          .filter(
            (e) =>
              e.kind === "purchase" &&
              e.currency === summary.currency &&
              !refunded.has(e.id) &&
              Date.parse(e.at) >= Date.parse(report.since) &&
              Date.parse(e.at) < cutoff,
          )
          .reduce((sum, e) => sum + e.amount, 0);
        expect(summary.spending === expected).toBe(true);
      }
      expect(
        JSON.stringify(await h.balances(actor)) === JSON.stringify(before),
      ).toBe(true);
    }
  });
  test("rates are timestamped stored observations; history and notifications are JSON", async () => {
    const actor = h.actors[0];
    const current = await h.ok<{ snapshots?: unknown[] }>(
      actor,
      "GET",
      "/api/rates/live",
    );
    expect(current !== null).toBe(true);
    expect(
      (
        await h.call(
          actor,
          "GET",
          "/api/rates/history?from=USD&to=ILS&period=7d",
        )
      ).status,
    ).toBe(200);
    await h.ok(actor, "POST", "/api/notifications/read", {});
    await h.ledger(actor);
  });
  test("real Sandbox funding configuration and history are separate from capture", async () => {
    const data = await h.ok<{ available: boolean; currencies: string[] }>(
      h.actors[0],
      "GET",
      "/api/funding",
    );
    test.skip(
      !data.available,
      "BLOCKED: Sandbox provider is not configured for Preview.",
    );
    expect(data.currencies.every((c) => ["USD", "ILS"].includes(c))).toBe(true);
  });
  // These need additional controlled provider/time/fault fixtures. They are
  // deliberately visible blockers, never synthetic successful live tests.
  for (const scenario of [
    "invalid credentials and cancelled Auth0 login without account lockout",
    "real expired signed Auth0 session and safe password-reset mailbox",
    "PayPal Sandbox login, challenged approval and verified capture recovery",
    "PayPal provider failure and duplicate capture against a real order",
    "controlled stale/missing FX observation and provider rate-limit response",
    "actual Gemini valid response with recommendation acceptance and dismissal",
    "controlled Gemini invalid JSON, timeout, missing configuration and outage",
    "expired invitation and proposal using an authorized test clock",
    "network interruption and refresh during a financial submission",
    "Circle completion, member changes during voting and transfer fault injection",
  ])
    test(scenario, async () =>
      test.skip(
        true,
        "BLOCKED: additional isolated provider, mailbox, clock or fault-injection fixture required; local coverage is recorded separately.",
      ),
    );
  test("logout clears the application session in each separate context", async () => {
    for (const actor of h.actors) {
      await h.ok(actor, "POST", "/api/logout", {});
      // SDK/provider logout must be exercised through the actual UI.
      const logout = actor.page.getByRole("button", {
        name: /^Log out$|^Sign out$/i,
      });
      test.skip(
        !(await logout.isVisible()),
        "BLOCKED: logout control needs live UI selector verification.",
      );
      await logout.click();
      await expect(
        actor.page.getByRole("button", {
          name: "Continue with email",
          exact: true,
        }),
      ).toBeVisible();
    }
  });
});
