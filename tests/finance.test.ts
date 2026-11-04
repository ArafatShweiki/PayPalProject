import { fundedUser } from "./fixtures/user";
import { describe, it, expect } from "vitest";
import { minor, roundUp, convert, crossRate, rateUnits } from "../shared/money";
import {
  initialUser,
  purchase,
  refund,
  balances,
  idempotent,
  goalSaved,
} from "../server/ledger";
describe("integer money", () => {
  it.each([
    ["23.40", "ILS", 500, 160],
    ["47.00", "ILS", 500, 300],
    ["12.35", "USD", 100, 65],
    ["8.90", "USD", 100, 10],
    ["7.350", "JOD", 1000, 650],
    ["25", "ILS", 500, 0],
    ["10", "USD", 100, 0],
    ["0.001", "JOD", 100, 99],
  ] as const)("rounds %s %s", (amount, currency, increment, expected) =>
    expect(roundUp(minor(amount, currency), increment)).toBe(expected),
  );
  it("rejects invalid precision, zero, negative, infinity and exponent notation", () => {
    for (const amount of ["0", "-1", "NaN", "Infinity", "1e2", "1.001", ""])
      expect(() => minor(amount, "USD")).toThrow();
    expect(() => roundUp(0, 100)).toThrow();
    expect(() => roundUp(1, 0)).toThrow();
    expect(() => roundUp(1.1, 100)).toThrow();
  });
  it("caps round-ups and handles large values", () => {
    expect(roundUp(2340, 500, 100)).toBe(100);
    expect(roundUp(99999999999, 2000)).toBe(1);
  });
  it("converts directions and three-decimal currencies with integer rounding", () => {
    const ils = { ILS: 1000000, USD: 3500000, JOD: 5000000 };
    expect(convert(50000, "USD", "ILS", crossRate("USD", "ILS", ils))).toBe(
      175000,
    );
    expect(convert(10000, "USD", "JOD", crossRate("USD", "JOD", ils))).toBe(
      70000,
    );
    expect(convert(1000, "JOD", "USD", crossRate("JOD", "USD", ils))).toBe(143);
    expect(rateUnits("3.099")).toBe(3099000);
    expect(() => convert(0, "USD", "ILS", 3500000)).toThrow();
  });
  it.each([
    ["USD", "ILS", 10000, 35000],
    ["ILS", "USD", 10000, 2857],
    ["USD", "JOD", 10000, 70000],
    ["JOD", "USD", 1000, 143],
    ["ILS", "JOD", 10000, 20000],
    ["JOD", "ILS", 1000, 500],
  ] as const)(
    "calculates the manual %s to %s direction in the correct minor units",
    (from, to, amount, expected) => {
      const rate = crossRate(from, to, {
        ILS: 1000000,
        USD: 3500000,
        JOD: 5000000,
      });
      expect(convert(amount, from, to, rate)).toBe(expected);
    },
  );
});
describe("ledger invariants", () => {
  it("keeps savings separate and reverses exactly once on full refund", () => {
    const d = fundedUser();
    d.preferences.savings = "enabled";
    d.preferences.goalIds.ILS = "goal";
    d.goals.push({
      id: "goal",
      currency: "ILS",
      name: "Goal",
      target: 10000,
      createdAt: new Date().toISOString(),
    });
    const e = purchase(d, "ILS", 2340, "Coffee", "Food & drink");
    expect(balances(d).ILS).toBe(647500);
    expect(balances(d, "savings").ILS).toBe(160);
    expect(goalSaved(d, "goal")).toBe(160);
    refund(d, e.id);
    refund(d, e.id);
    expect(balances(d).ILS).toBe(650000);
    expect(balances(d, "savings").ILS).toBe(0);
    expect(goalSaved(d, "goal")).toBe(0);
  });
  it("disabled savings never allocates and does not change opt-in", () => {
    const d = fundedUser();
    d.preferences.savings = "disabled";
    expect(purchase(d, "USD", 1235, "Lunch", "Food & drink").saved).toBe(0);
    expect(d.preferences.savings).toBe("disabled");
  });
  it("rejects insufficient balance atomically", () => {
    const d = fundedUser();
    d.preferences.savings = "enabled";
    const before = JSON.stringify(d);
    expect(() => purchase(d, "USD", 120001, "Large", "Other")).toThrow();
    expect(JSON.stringify(d)).toBe(before);
  });
  it("requires funds for the round-up as well as the purchase", () => {
    const d = fundedUser();
    d.preferences.savings = "enabled";
    d.preferences.increments.USD = 700;
    expect(() => purchase(d, "USD", 120000, "Large", "Other")).toThrow();
    expect(balances(d).USD).toBe(120000);
  });
  it("deduplicates and rejects re-used request identifiers with changed payload", () => {
    const d = fundedUser();
    d.preferences.savings = "enabled";
    const action = () => purchase(d, "USD", 1235, "Lunch", "Food & drink");
    const first = idempotent(d, "one", "same", action);
    expect(idempotent(d, "one", "same", action)).toEqual(first);
    expect(d.ledger).toHaveLength(4);
    expect(() => idempotent(d, "one", "different", action)).toThrow();
  });
});

it("only explicitly enabled demo accounts receive fictional opening balances", () => {
  expect(initialUser().ledger).toEqual([]);
  expect(fundedUser().ledger).toHaveLength(3);
});
