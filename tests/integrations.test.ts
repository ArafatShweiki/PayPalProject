import { fundedUser } from "./fixtures/user";
import { afterEach, describe, it, expect, vi } from "vitest";
import { purchase } from "../server/ledger";
import { parsePma, evaluateAlerts, stale } from "../server/rates";
import { buildReport, explain, aiSchema } from "../server/reports";
const html =
  "<table><tr><th>USD/ILS</th><td>3.60</td><td>3.50</td></tr><tr><th>JOD/ILS</th><td>5.1</td><td>5.0</td></tr></table>";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("PMA and alerts", () => {
  it("preserves inverted bid / ask labels and computes an explicit midpoint", () => {
    const s = parsePma(html);
    expect(s.ils.USD).toBe(3550000);
    expect(s.quotes[0].bid).toBe("3.60");
    expect(s.publishedAt).toBeNull();
    expect(() => parsePma("unavailable")).toThrow();
  });
  it("recognizes stale data", () =>
    expect(
      stale(parsePma(html, new Date(Date.now() - 48 * 3600000).toISOString())),
    ).toBe(true));
  it("alerts once, resets reference, respects cooldown and disabled notifications", () => {
    const d = fundedUser();
    d.alerts.push({
      id: "a",
      from: "USD",
      to: "ILS",
      direction: "increase",
      mode: "percent",
      threshold: 1,
      enabled: true,
      reference: 3500000,
    });
    const s = parsePma(html);
    evaluateAlerts(d, s);
    evaluateAlerts(d, s);
    expect(d.notices).toHaveLength(1);
    expect(d.alerts[0].reference).toBe(3550000);
    s.ils.USD = 4000000;
    evaluateAlerts(d, s);
    expect(d.notices).toHaveLength(1);
    d.alerts[0].lastTriggered = undefined;
    d.preferences.notifications = false;
    evaluateAlerts(d, s);
    expect(d.notices).toHaveLength(1);
  });
  it("does not evaluate stale snapshots", () => {
    const d = fundedUser();
    d.alerts.push({
      id: "a",
      from: "USD",
      to: "ILS",
      direction: "increase",
      mode: "absolute",
      threshold: 0.01,
      enabled: true,
      reference: 3000000,
    });
    evaluateAlerts(d, parsePma(html, "2020-01-01T00:00:00.000Z"));
    expect(d.notices).toHaveLength(0);
  });
});
describe("grounded reports", () => {
  it("compares equivalent periods with computed differences and handles a zero baseline", () => {
    const d = fundedUser();
    const now = Date.now();
    d.createdAt = new Date(now - 20 * 86400000).toISOString();
    const previous = purchase(d, "ILS", 1000, "Previous", "Other");
    previous.at = new Date(now - 10 * 86400000).toISOString();
    const current = purchase(d, "ILS", 2340, "Current", "Other");
    current.at = new Date(now - 86400000).toISOString();
    const { report } = buildReport(d, "weekly", now);
    expect(report.summaries[0].previousSpending).toBe(1000);
    expect(report.summaries[0].spendingChange).toBe(1340);
    expect(report.summaries[0].spendingChangePercent).toBe(134);
    expect(report.summaries[1].spendingChangePercent).toBeNull();
  });
  it("calculates impact by replaying purchases and never changes preferences", () => {
    const d = fundedUser();
    d.preferences.savings = "enabled";
    purchase(d, "ILS", 2340, "untrusted merchant instruction", "Food & drink");
    const before = JSON.stringify(d.preferences);
    const { report, recommendations } = buildReport(
      d,
      "monthly",
      Date.now() + 1000,
    );
    expect(report.summaries[0].spending).toBe(2340);
    expect(report.summaries[0].savings).toBe(160);
    expect(recommendations[0].additional).toBe(500);
    expect(report.summaries[0].previousSpending).toBeNull();
    expect(JSON.stringify(d.preferences)).toBe(before);
  });
  it("falls back when Gemini is down or returns invalid output", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const d = fundedUser();
    purchase(d, "USD", 1235, "Coffee", "Food & drink");
    const { report } = buildReport(d, "weekly", Date.now() + 1000);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await explain(report, [])).source).toBe("deterministic");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: '{"observations":42}' }] } },
          ],
        }),
      }),
    );
    expect((await explain(report, [])).source).toBe("deterministic");
    expect(() =>
      aiSchema.parse({ observations: ["ok"], changeRule: true }),
    ).toThrow();
  });
});
