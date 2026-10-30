import type { Currency } from "./money";
import { crossRate } from "./money";
import type { Snapshot } from "./types";
export const observationTime = (s: Snapshot) => s.publishedAt ?? s.fetchedAt;
export function snapshotRate(s: Snapshot, from: Currency, to: Currency) {
  if (from === to) return 1000000;
  const direct = s.market?.legs.find((q) => q.symbol === `${from}/${to}`);
  if (direct) return direct.rate;
  const inverse = s.market?.legs.find((q) => q.symbol === `${to}/${from}`);
  if (inverse)
    return Number(
      (1000000000000n + BigInt(inverse.rate) / 2n) / BigInt(inverse.rate),
    );
  return crossRate(from, to, s.ils);
}
export function pairTime(s: Snapshot, from: Currency, to: Currency) {
  const direct = s.market?.legs.find(
    (q) => q.symbol === `${from}/${to}` || q.symbol === `${to}/${from}`,
  );
  return direct?.observedAt ?? observationTime(s);
}
export function pairStatus(s: Snapshot, from: Currency, to: Currency) {
  if (!s.market) return "unknown";
  const direct = s.market.legs.find(
    (q) => q.symbol === `${from}/${to}` || q.symbol === `${to}/${from}`,
  );
  const legs = direct ? [direct] : s.market.legs;
  return legs.some((q) => q.marketOpen === false)
    ? "closed"
    : legs.every((q) => q.marketOpen === true)
      ? "open"
      : "unknown";
}
export function rateMethod(s: Snapshot, from: Currency, to: Currency) {
  if (!s.market) return "Indicative midpoint / calculated cross-rate";
  if (s.market.legs.some((q) => q.symbol === `${from}/${to}`))
    return "Direct provider quote";
  if (s.market.legs.some((q) => q.symbol === `${to}/${from}`))
    return "Calculated inverse";
  return "Calculated indicative cross-rate";
}
export function isQuoteStale(
  s: Snapshot,
  from: Currency,
  to: Currency,
  threshold: number,
  now = Date.now(),
) {
  const observed = Date.parse(pairTime(s, from, to));
  return (
    !Number.isFinite(observed) ||
    observed > now + 60000 ||
    now - observed > threshold
  );
}
export const historyPeriods = {
  "1h": { ms: 3600000, bucket: 60 },
  "24h": { ms: 86400000, bucket: 300 },
  "7d": { ms: 7 * 86400000, bucket: 1800 },
  "30d": { ms: 30 * 86400000, bucket: 10800 },
  "90d": { ms: 90 * 86400000, bucket: 21600 },
} as const;
export type HistoryPeriod = keyof typeof historyPeriods;
