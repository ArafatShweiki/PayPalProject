import { rateStaleMs } from "./rates.js";
import { money, type Currency } from "../shared/money.js";
import type { CurrencyInsight, Snapshot } from "../shared/types.js";
import { explainFacts, cachedExplanation } from "./ai.js";
import { currencyFacts } from "../shared/currency-insights.js";
import type { ComparisonPeriod } from "../shared/currency-insights.js";
export { currencyFacts } from "../shared/currency-insights.js";
export async function currencyInsight(
  snapshots: Snapshot[],
  from: Currency,
  to: Currency,
  amount: number,
  uid?: string,
  period: ComparisonPeriod = "available",
): Promise<CurrencyInsight> {
  const result = currencyFacts(
    snapshots,
    from,
    to,
    amount,
    rateStaleMs(),
    period,
  );
  const facts = {
    pair: `${from}/${to}`,
    selectedAmount: money(amount, from),
    indicativeValue: money(result.received, to),
    rate: result.rate / 1e6,
    referenceRate:
      result.referenceRate === null ? null : result.referenceRate / 1e6,
    changePercent: result.changePercent,
    indicativeValueChange:
      result.difference === null ? null : money(result.difference, to),
    minimumRate: result.minimumRate / 1e6,
    maximumRate: result.maximumRate / 1e6,
    observationCount: result.observationCount,
    fetchedAt: result.fetchedAt,
    referenceAt: result.referenceAt,
    comparisonPeriod: period,
    stale: result.stale,
    observationTime: result.observedAt ?? "not supplied",
    fees: "unknown",
    monitorThresholdPercent: result.monitorThresholdPercent,
  };
  const instruction =
    "Explain this user's selected simulated wallet amount and conversion direction in plain language. All numbers are already calculated. Historical comparison is limited to the provided stored observations; one observation cannot establish a trend. No personal data is provided. Use at most two short sentences about the conversion impact only. Do not infer market causes, forecast prices or promise profit. If stale, state that the quote is not current. Use qualitative text only; do not quote numbers, rates, amounts or percentages.";
  const cached = uid
    ? await cachedExplanation(facts, instruction, `${uid}:currency`)
    : null;
  const explanation = uid
    ? cached?.value
    : await explainFacts(
        facts,
        "Explain this user's selected simulated wallet amount and conversion direction in plain language. All numbers are already calculated. Historical comparison is limited to the provided stored observations; one observation cannot establish a trend. No personal data is provided. Use at most two short sentences about the conversion impact only. Do not infer market causes, forecast prices or promise profit. If stale, state that the quote is not current. Use qualitative text only; do not quote numbers, rates, amounts or percentages.",
      );
  const qualitative = explanation?.filter(
    (text) => !/[0-9%$\u20aa]/.test(text),
  );
  return qualitative?.length
    ? {
        ...result,
        source: "Gemini",
        observations: qualitative,
        ...(cached
          ? {
              explanationCache: {
                generatedAt: cached.generatedAt,
                cached: cached.cached,
              },
            }
          : {}),
      }
    : result;
}
