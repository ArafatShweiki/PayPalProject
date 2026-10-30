vi.hoisted(() => {
  process.env.DATABASE_PATH = "data/forex-alerts-test.db";
});
import { expect, it, vi } from "vitest";
import { initialUser } from "../shared/ledger";
import { evaluateAlerts } from "../server/rates";
import { parseForexQuotes } from "../server/forex";
const snapshot = (price: string, offset = 0) => {
  const now = Math.floor(Date.now() / 1000) + offset;
  return parseForexQuotes(
    [
      { symbol: "USD/ILS", close: price, timestamp: now, is_market_open: true },
      { symbol: "USD/JOD", close: "0.7", timestamp: now, is_market_open: true },
    ],
    ["USD/ILS", "USD/JOD"],
    now * 1000,
  );
};
it("triggers target crossings once and respects observation deduplication/cooldown", () => {
  const data = initialUser(true);
  data.preferences.notifications = true;
  data.alerts = [
    {
      id: "a",
      from: "USD",
      to: "ILS",
      direction: "increase",
      mode: "target",
      threshold: 3.6,
      enabled: true,
      reference: 3500000,
    },
  ];
  evaluateAlerts(data, snapshot("3.5"));
  expect(data.notices).toHaveLength(0);
  const crossed = snapshot("3.7", 1);
  evaluateAlerts(data, crossed);
  expect(data.notices).toHaveLength(1);
  evaluateAlerts(data, crossed, Date.now() + 25 * 3600000);
  expect(data.notices).toHaveLength(1);
  evaluateAlerts(data, snapshot("3.4", 2));
  evaluateAlerts(data, snapshot("3.8", 3));
  expect(data.notices).toHaveLength(1);
});
