import { reportPeriod } from "./report-period.js";
import { currencies, roundUp, money } from "./money.js";
import type { UserData, Report, Recommendation } from "./types.js";
import {
  balances,
  emptyBalances,
  generalSavings,
  goalSaved,
} from "./ledger.js";
function add(a: number, b: number): number {
  const result = a + b;
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    !Number.isSafeInteger(result)
  )
    throw new Error("Report totals exceed supported precision.");
  return result;
}
const randomUUID = () => globalThis.crypto.randomUUID();
export function buildReport(
  data: UserData,
  frequency: "weekly" | "monthly",
  now = Date.now(),
  selected?: string,
  timezone = "UTC",
): { report: Report; recommendations: Recommendation[] } {
  const period = reportPeriod(frequency, now, selected, timezone);
  const { start, previousStart: prior, asOf } = period;
  const refunded = new Set(
    data.ledger
      .filter(
        (e) =>
          (e.kind === "refund" || e.kind === "reversal") &&
          Date.parse(e.at) < asOf,
      )
      .map((e) => e.originalId),
  );
  const purchases = data.ledger.filter(
    (e) => e.kind === "purchase" && !refunded.has(e.id),
  );
  const savingsRefunded = new Set(
    data.ledger
      .filter(
        (e) =>
          (e.kind === "refund" || e.kind === "reversal") &&
          !e.savingsRetained &&
          Date.parse(e.at) < asOf,
      )
      .map((e) => e.originalId),
  );
  const savingsPurchases = data.ledger.filter(
    (e) => e.kind === "purchase" && !savingsRefunded.has(e.id),
  );
  const circleSavings = emptyBalances();
  for (const e of data.circleEntries || [])
    if (Date.parse(e.at) < asOf)
      circleSavings[e.currency] = add(circleSavings[e.currency], e.amount);
  const personalSavings = balances(
    { ...data, ledger: data.ledger.filter((e) => Date.parse(e.at) < asOf) },
    "savings",
  );
  const totalSavings = emptyBalances();
  for (const c of currencies)
    totalSavings[c] = add(personalSavings[c], circleSavings[c]);
  const report: Report = {
    circleSavings,
    totalSavings,
    savingsBalances: balances(
      { ...data, ledger: data.ledger.filter((e) => Date.parse(e.at) < asOf) },
      "savings",
    ),
    generalSavings: generalSavings({
      ...data,
      ledger: data.ledger.filter((e) => Date.parse(e.at) < asOf),
    }),
    id: randomUUID(),
    at: new Date(now).toISOString(),
    since: new Date(start).toISOString(),
    frequency,
    until: new Date(period.end).toISOString(),
    timezone,
    complete: period.complete,
    previousUntil: new Date(period.previousEnd).toISOString(),
    source: "deterministic",
    observations: [],
    goals: data.goals
      .filter((g) => Date.parse(g.createdAt) < asOf)
      .map((g) => {
        const saved = goalSaved(
          {
            ...data,
            ledger: data.ledger.filter((e) => Date.parse(e.at) < asOf),
          },
          g.id,
        );
        if (
          !Number.isSafeInteger(g.target) ||
          g.target <= 0 ||
          !Number.isSafeInteger(saved) ||
          saved < 0
        )
          throw new Error("Invalid goal financial totals.");
        return {
          name: g.name,
          currency: g.currency,
          target: g.target,
          saved,
          progressPercent: Math.min(
            100,
            Number((BigInt(saved) * 10000n) / BigInt(g.target)) / 100,
          ),
        };
      }),
    summaries: currencies.map((currency) => {
      const rows = purchases.filter(
        (e) =>
          e.currency === currency &&
          Date.parse(e.at) >= start &&
          Date.parse(e.at) < asOf,
      );
      const categories: Record<string, number> = Object.create(null);
      for (const e of rows)
        categories[e.category] = add(categories[e.category] ?? 0, e.amount);
      const spending = rows.reduce((sum, e) => add(sum, e.amount), 0);
      const previousRows =
        Date.parse(data.createdAt) <= prior
          ? purchases.filter(
              (e) =>
                e.currency === currency &&
                Date.parse(e.at) >= prior &&
                Date.parse(e.at) < period.previousEnd,
            )
          : null;
      const previousSpending =
        previousRows?.reduce((sum, e) => add(sum, e.amount), 0) ?? null;
      const previousSavings =
        Date.parse(data.createdAt) <= prior
          ? savingsPurchases
              .filter(
                (e) =>
                  e.currency === currency &&
                  Date.parse(e.at) >= prior &&
                  Date.parse(e.at) < period.previousEnd,
              )
              .reduce((sum, e) => add(sum, e.saved), 0)
          : null;
      const savings = savingsPurchases
        .filter(
          (e) =>
            e.currency === currency &&
            Date.parse(e.at) >= start &&
            Date.parse(e.at) < asOf,
        )
        .reduce((sum, e) => add(sum, e.saved), 0);
      return {
        currency,
        count: rows.length,
        spending,
        savings,
        averageSpending: rows.length
          ? Number(
              (BigInt(spending) + BigInt(Math.floor(rows.length / 2))) /
                BigInt(rows.length),
            )
          : null,
        previousSavings,
        savingsChange:
          previousSavings === null ? null : savings - previousSavings,
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
  const available = balances(data);
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
        Date.parse(e.at) < asOf,
    );
    const estimatedSavings = rows.reduce(
      (sum, e) =>
        add(
          sum,
          roundUp(e.amount, suggested, data.preferences.caps[s.currency]),
        ),
      0,
    );
    // Compare the historical alternative with actual allocations, including rule changes.
    const additional = estimatedSavings - s.savings;
    if (
      additional > 0 &&
      available[s.currency] >=
        Math.max(
          additional,
          Math.min(suggested, data.preferences.caps[s.currency]),
        ) &&
      data.preferences.savings === "enabled" &&
      data.savingsRuleEnabled?.[s.currency] !== false
    )
      recommendations.push({
        id: randomUUID(),
        reportId: report.id,
        cap: data.preferences.caps[s.currency],
        settingsSnapshot: {
          increments: { ...data.preferences.increments },
          caps: { ...data.preferences.caps },
          destination: data.preferences.savingsDestination ?? null,
        },
        ledgerRevision:
          data.ledger.filter((e) => e.postings.length > 0).at(-1)?.id ?? "",
        currency: s.currency,
        current,
        suggested,
        additional,
        estimatedSavings,
        recordedSavings: s.savings,
        status: "pending",
      });
  }
  if (!report.observations.length)
    report.observations.push(
      "Record your first purchase to start a spending and savings report.",
    );
  if (report.summaries.every((s) => s.previousSpending === null))
    report.observations.push(
      "Not enough recorded history for a previous-period comparison.",
    );
  report.observations.push(
    period.complete
      ? "Completed reporting period."
      : "Period in progress; comparisons use the same elapsed portion of the previous period.",
  );
  if (
    report.summaries.some(
      (s) =>
        !Number.isSafeInteger(s.spending) || !Number.isSafeInteger(s.savings),
    )
  )
    throw new Error("Report totals exceed supported precision.");
  return { report, recommendations };
}
