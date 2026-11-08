import { expect, it } from "vitest";
import {
  buildCoach,
  strategy,
  coachAdvice,
  type CoachInput,
} from "../shared/coach";
import { spendingMovement } from "../shared/spending";
import { initialUser, purchase, refund } from "../shared/ledger";
import { fundedUser } from "./fixtures/user";
import { buildReport } from "../shared/reports";
export function coachInput(): CoachInput {
  return {
    asOf: "2026-11-06T12:00:00.000Z",
    goals: [
      {
        id: "g",
        name: "Laptop",
        currency: "USD",
        target: 6000,
        saved: 3000,
        createdAt: "2026-10-09T12:00:00.000Z",
      },
    ],
    samples: ["2026-10-16", "2026-10-23", "2026-10-30"].map((at) => ({
      goalId: "g",
      at: at + "T12:00:00.000Z",
      amount: 1000,
      paceAmount: 1000,
    })),
    available: { ILS: 0, USD: 5000, JOD: 0 },
    guide: { dismissed: false, walletViewed: false, circlesViewed: false },
    steps: { funded: false, goal: true, enabled: true, purchased: true },
  };
}
it("projects from exact net minor units and a full observation period", () => {
  const g = buildCoach(coachInput()).outlooks[0];
  expect(g).toMatchObject({
    status: "estimated",
    weekly: 750,
    daysObserved: 28,
    completion: "2026-12-04T12:00:00.000Z",
    weeks: 4,
  });
  expect(g.history[0].amount).toBe(0);
  expect(g.history.at(-1)?.amount).toBe(3000);
});
it.each(["USD", "ILS", "JOD"] as const)(
  "preserves %s precision and rounds the date upward",
  (currency) => {
    const d = coachInput();
    d.goals[0] = { ...d.goals[0], currency, target: 3001 };
    const g = buildCoach(d).outlooks[0];
    expect(g.completion).toBe("2026-11-07T12:00:00.000Z");
    expect(strategy(1, 3, d.asOf).completion).toBe("2026-11-09T12:00:00.000Z");
  },
);
it("requires fourteen days even with several deposits", () => {
  const d = coachInput();
  d.goals[0].createdAt = "2026-11-01T12:00:00.000Z";
  expect(buildCoach(d).outlooks[0]).toMatchObject({
    status: "insufficient",
    completion: null,
  });
});
it("requires three contributions on at least two distinct dates", () => {
  const d = coachInput();
  d.samples.forEach((s) => (s.at = "2026-10-30T12:00:00.000Z"));
  expect(buildCoach(d).outlooks[0].status).toBe("insufficient");
  d.samples = d.samples.slice(0, 2);
  expect(buildCoach(d).outlooks[0].status).toBe("insufficient");
});
it.each([0, -1000])("does not predict a date with %i net pace", (net) => {
  const d = coachInput();
  d.samples.push({
    goalId: "g",
    at: d.asOf,
    amount: net - 3000,
    paceAmount: net - 3000,
  });
  d.goals[0].saved = Math.max(0, net);
  expect(buildCoach(d).outlooks[0]).toMatchObject({
    status: "stalled",
    weekly: 0,
    completion: null,
  });
});
it("subtracts reversals and keeps existing-savings assignments out of pace", () => {
  const d = coachInput();
  d.samples.push(
    { goalId: "g", at: d.asOf, amount: -1000, paceAmount: -1000 },
    { goalId: "g", at: d.asOf, amount: 500, paceAmount: 0 },
  );
  d.goals[0].saved = 2500;
  const g = buildCoach(d).outlooks[0];
  expect(g.weekly).toBe(500);
  expect(g.netContributions).toBe(2000);
  expect(g.history.at(-1)?.amount).toBe(2500);
  expect(g.weeks).toBe(7);
});
it.each([6000, 7000])("handles completed/overfunded balance %i", (saved) => {
  const d = coachInput();
  d.goals[0].saved = saved;
  expect(buildCoach(d).outlooks[0]).toMatchObject({
    status: "completed",
    remaining: 0,
    weeks: null,
    completion: d.asOf,
  });
});
it("keeps archived goals separate from active forecasts", () => {
  const d = coachInput();
  d.goals[0].archived = true;
  expect(buildCoach(d).outlooks[0]).toMatchObject({
    status: "archived",
    completion: null,
  });
});
it("ignores future and older samples", () => {
  const d = coachInput();
  d.samples.push(
    {
      goalId: "g",
      at: "2027-01-01T00:00:00Z",
      amount: 999999,
      paceAmount: 999999,
    },
    {
      goalId: "g",
      at: "2026-01-01T00:00:00Z",
      amount: 999999,
      paceAmount: 999999,
    },
  );
  expect(buildCoach(d).outlooks[0].weekly).toBe(750);
});
it("compares hypothetical amounts without mutating source data", () => {
  const d = coachInput(),
    before = JSON.stringify(d);
  expect(strategy(3000, 1500, d.asOf)).toMatchObject({
    weeks: 2,
    completion: "2026-11-20T12:00:00.000Z",
  });
  expect(JSON.stringify(d)).toBe(before);
  expect(strategy(3000, 0, d.asOf).completion).toBeNull();
  expect(strategy(0, 0, d.asOf).weeks).toBe(0);
});
it.each([-1, 0.1, NaN, Infinity])(
  "rejects invalid hypothetical pace %s",
  (pace) => expect(() => strategy(100, pace, coachInput().asOf)).toThrow(),
);
it("bounds date projections without manufacturing a target crossing", () =>
  expect(
    strategy(Number.MAX_SAFE_INTEGER, 1, coachInput().asOf).completion,
  ).toBeNull());
it("does not suggest increases with no available funds", () =>
  expect(coachAdvice(buildCoach(coachInput()).outlooks[0], 0)).toContain(
    "Review your wallet",
  ));
it("nets merchant refunds without counting round-ups or funding as spending", () => {
  const d = fundedUser();
  d.preferences.savings = "enabled";
  const p = purchase(d, "USD", 1299, "Coffee", "Food & drink");
  expect(spendingMovement(p)).toEqual({ net: 1299, gross: 1299, refunds: 0 });
  expect(spendingMovement(refund(d, p.id))).toEqual({
    net: -1299,
    gross: 0,
    refunds: 1299,
  });
  expect(spendingMovement(d.ledger[0]).net).toBe(0);
});
it("suppresses increased round-up suggestions for an unfunded account", () => {
  const d = initialUser();
  d.preferences.savings = "enabled";
  d.ledger = [
    {
      id: "p",
      kind: "purchase",
      at: new Date().toISOString(),
      currency: "USD",
      amount: 101,
      saved: 0,
      description: "Purchase",
      category: "Other",
      postings: [
        { currency: "USD", account: "external", amount: 101 },
        { currency: "USD", account: "available", amount: -101 },
      ],
    },
  ];
  expect(buildReport(d, "monthly").recommendations).toEqual([]);
});

it("uses the full elapsed observation interval rather than rounding away a partial day", () => {
  const d = coachInput();
  d.asOf = "2026-11-07T00:00:00.000Z";
  expect(buildCoach(d).outlooks[0].completion).toBe("2026-12-06T00:00:00.000Z");
});
