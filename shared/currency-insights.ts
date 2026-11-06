import { snapshotRate, pairTime, isQuoteStale } from "./market.js";
import { convert, money, changePercent, type Currency } from "./money.js";
import type { CurrencyInsight, Snapshot } from "./types.js";
export const comparisonPeriods = {
  "24h": 86400000,
  "7d": 7 * 86400000,
  "30d": 30 * 86400000,
};
export type ComparisonPeriod = "available" | keyof typeof comparisonPeriods;
export function currencyFacts(
  snapshots: Snapshot[],
  from: Currency,
  to: Currency,
  amount: number,
  staleMs = 36 * 3600000,
  period: ComparisonPeriod = "available",
): CurrencyInsight {
  if (from === to) throw new Error("Select two different currencies.");
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Choose a positive amount to analyze.");
  snapshots = [...new Map(snapshots.map((s) => [s.id, s])).values()]
    .filter(
      (s) =>
        Number.isFinite(Date.parse(pairTime(s, from, to))) &&
        Date.parse(pairTime(s, from, to)) <= Date.now() + 60000,
    )
    .sort(
      (a, b) =>
        Date.parse(pairTime(a, from, to)) - Date.parse(pairTime(b, from, to)),
    );
  const latest = snapshots.at(-1);
  if (!latest) throw new Error("Refresh rates before requesting an insight.");
  const ordered = snapshots
    .filter(
      (s) =>
        s.source === latest.source &&
        Number.isFinite(Date.parse(pairTime(s, from, to))) &&
        Date.parse(pairTime(s, from, to)) <=
          Date.parse(pairTime(latest, from, to)),
    )
    .sort(
      (a, b) =>
        Date.parse(pairTime(a, from, to)) - Date.parse(pairTime(b, from, to)),
    );
  const cutoff =
    period === "available"
      ? null
      : Date.parse(pairTime(latest, from, to)) - comparisonPeriods[period];
  const reference =
    ordered.length > 1
      ? cutoff === null
        ? ordered[0]
        : (ordered
            .filter((s) => Date.parse(pairTime(s, from, to)) <= cutoff)
            .at(-1) ?? null)
      : null;
  const rate = snapshotRate(latest, from, to);
  const referenceRate = reference ? snapshotRate(reference, from, to) : null;
  const received = convert(amount, from, to, rate);
  const previousValue = referenceRate
    ? convert(amount, from, to, referenceRate)
    : null;
  const observedRates = ordered.map((s) => snapshotRate(s, from, to));
  const change = referenceRate ? changePercent(rate, referenceRate) : null;
  const steps = observedRates
    .slice(1)
    .map((rate, i) => Math.abs(changePercent(rate, observedRates[i])));
  const maximumStep = steps.length ? Math.max(...steps) : 0;
  const monitorThresholdPercent =
    maximumStep > 0 ? Math.ceil(maximumStep * 100) / 100 : null;
  const observations = [
    `${money(amount, from)} has an indicative conversion value of ${money(received, to)} at this recorded rate, before unknown fees and spreads.`,
    reference && change !== null
      ? `${from}/${to} ${change > 0 ? "increased" : change < 0 ? "decreased" : "was unchanged"} by ${Math.abs(change).toFixed(2)}% since ${pairTime(reference, from, to)}. The change in indicative value is ${money(received - previousValue!, to)}, not guaranteed profit.`
      : "There is not enough stored history for this comparison.",
  ];
  if (reference)
    observations.push(
      `Across ${ordered.length} stored observations, the recorded rate ranged from ${(Math.min(...observedRates) / 1e6).toFixed(6)} to ${(Math.max(...observedRates) / 1e6).toFixed(6)}. A higher rate yields more target currency for this conversion direction; it does not predict the next rate.`,
    );
  if (isQuoteStale(latest, from, to, staleMs))
    observations.push(
      "This retrieved observation is stale. Refresh rates before considering a new simulated exchange.",
    );
  return {
    from,
    comparisonPeriod: period,
    earliestAt: ordered[0] ? pairTime(ordered[0], from, to) : undefined,
    to,
    amount,
    rate,
    received,
    referenceRate,
    previousValue,
    difference: previousValue === null ? null : received - previousValue,
    changePercent: change,
    minimumRate: Math.min(...observedRates),
    maximumRate: Math.max(...observedRates),
    observationCount: ordered.length,
    fetchedAt: latest.fetchedAt,
    observedAt: pairTime(latest, from, to),
    referenceAt: reference ? pairTime(reference, from, to) : null,
    sourceUrl: latest.source,
    stale: isQuoteStale(latest, from, to, staleMs),
    source: "deterministic",
    monitorThresholdPercent,
    observations,
  };
}
