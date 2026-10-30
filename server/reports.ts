import { explainFacts, cachedExplanation } from "./ai";
import type { Report, Snapshot } from "../shared/types";
export { buildReport } from "../shared/reports";
export { aiSchema } from "./ai";
export async function explain(
  report: Report,
  rates: Snapshot[],
  uid?: string,
  revision = "",
): Promise<Report> {
  if (!report.summaries.some((s) => s.count)) return report;
  const facts = {
    summaries: report.summaries,
    goals: report.goals.map(({ currency, target, saved }) => ({
      currency,
      target,
      saved,
    })),
    rates: rates.slice(-2).map((s) => ({ at: s.fetchedAt, ils: s.ils })),
  };
  const instruction =
    "Explain this simulated wallet report. Amounts are integer minor units (ILS/USD 100 per unit, JOD 1000); rates are millionths. Give short qualitative observations and practical savings advice. Names and merchant descriptions are excluded. Compare periods only when previousSpending is not null. PMA times are retrieval times, not publication times.";
  const cached = uid
    ? await cachedExplanation(
        facts,
        instruction,
        `${uid}:report:${report.frequency}`,
        revision,
      )
    : null;
  const observations = uid
    ? cached?.value
    : await explainFacts(
        facts,
        "Explain this simulated wallet report. Amounts are integer minor units (ILS/USD 100 per unit, JOD 1000); rates are millionths. Give short qualitative observations and practical savings advice. Names and merchant descriptions are excluded. Compare periods only when previousSpending is not null. PMA times are retrieval times, not publication times.",
      );
  return observations
    ? {
        ...report,
        source: "Gemini",
        observations,
        ...(cached
          ? {
              explanationCache: {
                generatedAt: cached.generatedAt,
                cached: cached.cached,
              },
            }
          : {}),
      }
    : {
        ...report,
        observations: process.env.GEMINI_API_KEY
          ? [
              ...report.observations,
              "Gemini is unavailable. This report uses verified application calculations.",
            ]
          : report.observations,
      };
}
