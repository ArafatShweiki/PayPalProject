import { it, expect } from "vitest";
import {
  initialUser,
  append,
  purchase,
  refund,
  balances,
} from "../shared/ledger";
import { buildReport } from "../shared/reports";
it("keeps funding out of spending and savings while subsequent purchases still round up and refund accurately", () => {
  const data = initialUser();
  data.preferences.savings = "enabled";
  append(data, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: "funding",
    currency: "USD",
    amount: 5000,
    saved: 0,
    description: "Funds Added",
    category: "Funding",
    status: "COMPLETED",
    postings: [
      { currency: "USD", account: "available", amount: 5000 },
      { currency: "USD", account: "external", amount: -5000 },
    ],
  });
  const summary = () =>
    buildReport(data, "monthly", Date.now() + 1000).report.summaries.find(
      (s) => s.currency === "USD",
    )!;
  expect(summary()).toMatchObject({ spending: 0, savings: 0, count: 0 });
  const bought = purchase(data, "USD", 1235, "Coffee", "Food & Drink");
  expect(bought.saved).toBe(65);
  expect(balances(data).USD).toBe(3700);
  expect(balances(data, "savings").USD).toBe(65);
  expect(summary()).toMatchObject({ spending: 1235, savings: 65, count: 1 });
  refund(data, bought.id);
  expect(balances(data).USD).toBe(5000);
  expect(balances(data, "savings").USD).toBe(0);
  expect(summary()).toMatchObject({ spending: 0, savings: 0, count: 0 });
});
