import { currencies, roundUp, money } from "./money";
import type { UserData, Report, Recommendation } from "./types";
import { goalSaved } from "./ledger";
const randomUUID = () => globalThis.crypto.randomUUID();
export function buildReport(
  data: UserData,
  frequency: "weekly" | "monthly",
  now = Date.now(),
): { report: Report; recommendations: Recommendation[] } {
  const days = frequency === "weekly" ? 7 : 30;
  const start = now - days * 86400000;
  const prior = start - days * 86400000;
  const refunded = new Set(
    data.ledger.filter((e) => e.kind === "refund").map((e) => e.originalId),
  );
  const purchases = data.ledger.filter(
    (e) => e.kind === "purchase" && !refunded.has(e.id),
  );
  const report: Report = {
    id: randomUUID(),
    at: new Date(now).toISOString(),
    since: new Date(start).toISOString(),
    frequency,
    source: "deterministic",
    observations: [],
    goals: data.goals.map((g) => ({
      name: g.name,
      currency: g.currency,
      target: g.target,
      saved: goalSaved(data, g.id),
    })),
    summaries: currencies.map((currency) => {
      const rows = purchases.filter(
        (e) =>
          e.currency === currency &&
          Date.parse(e.at) >= start &&
          Date.parse(e.at) <= now,
      );
      const categories: Record<string, number> = {};
      for (const e of rows)
        categories[e.category] = (categories[e.category] ?? 0) + e.amount;
      const spending = rows.reduce((sum, e) => sum + e.amount, 0);
      const previousSpending =
        Date.parse(data.createdAt) <= prior
          ? purchases
              .filter(
                (e) =>
                  e.currency === currency &&
                  Date.parse(e.at) >= prior &&
                  Date.parse(e.at) < start,
              )
              .reduce((sum, e) => sum + e.amount, 0)
          : null;
      return {
        currency,
        count: rows.length,
        spending,
        savings: rows.reduce((s, e) => s + e.saved, 0),
        categories,
        previousSpending,
        spendingChange:
          previousSpending === null ? null : spending - previousSpending,
        spendingChangePercent:
          previousSpending === null || previousSpending === 0
            ? null
            : ((spending - previousSpending) / previousSpending) * 100,
      };
    }),
  };
  const recommendations: Recommendation[] = [];
  for (const s of report.summaries) {
    if (!s.count) continue;
    report.observations.push(
      `${s.count} ${s.currency} purchases: ${money(s.spending, s.currency)} spent and ${money(s.savings, s.currency)} allocated through round-ups.`,
    );
    const current = data.preferences.increments[s.currency];
    const suggested = current * 2;
    if (suggested > (s.currency === "JOD" ? 1000000 : 100000)) continue;
    const rows = purchases.filter(
      (e) =>
        e.currency === s.currency &&
        Date.parse(e.at) >= start &&
        Date.parse(e.at) <= now,
    );
    const additional = rows.reduce(
      (sum, e) =>
        sum +
        roundUp(e.amount, suggested, data.preferences.caps[s.currency]) -
        roundUp(e.amount, current, data.preferences.caps[s.currency]),
      0,
    );
    if (additional > 0 && data.preferences.savings === "enabled")
      recommendations.push({
        id: randomUUID(),
        reportId: report.id,
        cap: data.preferences.caps[s.currency],
        ledgerRevision: data.ledger.at(-1)?.id ?? "",
        currency: s.currency,
        current,
        suggested,
        additional,
        status: "pending",
      });
  }
  if (!report.observations.length)
    report.observations.push(
      "Make your first simulated purchase to start a spending and savings report.",
    );
  if (report.summaries.every((s) => s.previousSpending === null))
    report.observations.push(
      "Not enough recorded history for a previous-period comparison.",
    );
  return { report, recommendations };
}
