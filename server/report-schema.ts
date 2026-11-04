import { z } from "zod";
import type { Recommendation, Report } from "../shared/types";

const prose = z.string().trim().min(1).max(350);
export const reportContentSchema = z
  .object({
    summary: prose,
    spendingInsights: z.array(prose).max(3),
    savingsInsights: z.array(prose).max(3),
    recommendations: z
      .array(z.object({ id: z.string().max(128), description: prose }).strict())
      .max(3),
    nextSteps: z.array(prose).max(3),
  })
  .strict();

export function validateReportContent(
  input: unknown,
  candidates: Recommendation[],
  report?: Report,
) {
  const content = reportContentSchema.parse(input);
  const text = [
    content.summary,
    ...content.spendingInsights,
    ...content.savingsInsights,
    ...content.recommendations.map((r) => r.description),
    ...content.nextSteps,
  ].join(" ");
  // Financial figures are rendered from trusted fields, never from model prose.
  if (
    /[\p{N}%$₪]/u.test(text) ||
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|double|triple|half|quarter|guarantee\w*|risk.free|buy stocks|invest in)\b/i.test(
      text,
    )
  )
    throw new Error("Unsupported AI claims.");
  const ids = new Set<string>();
  for (const item of content.recommendations) {
    const candidate = candidates.find((r) => r.id === item.id);
    if (
      !candidate ||
      ids.has(item.id) ||
      candidate.additional <= 0 ||
      candidate.suggested !== candidate.current * 2
    )
      throw new Error("Unsupported AI recommendation.");
    ids.add(item.id);
  }
  if (report) {
    for (const observation of [
      content.summary,
      ...content.spendingInsights,
      ...content.savingsInsights,
    ]) {
      // Reject explicit past-tense trend claims that conflict with computed comparisons.
      // Conditional suggestions are handled separately through validated candidate IDs.
      const increase = /\b(increased|rose|grew|was higher|has risen)\b/i.test(
        observation,
      );
      const decrease =
        /\b(decreased|fell|declined|was lower|has fallen)\b/i.test(observation);
      if (!increase && !decrease) continue;
      const isSpending = /\bspend(?:ing)?\b/i.test(observation);
      const isSavings = /\bsavings\b/i.test(observation);
      if (!isSpending && !isSavings)
        throw new Error("Unsupported trend claim.");
      const mentioned = observation.match(/\b(?:ILS|USD|JOD)\b/g);
      const relevant = report.summaries.filter(
        (s) => mentioned?.includes(s.currency) ?? s.count > 0,
      );
      if (
        !relevant.length ||
        relevant.some((s) => {
          const changes = [
            ...(isSpending ? [s.spendingChange] : []),
            ...(isSavings ? [s.savingsChange] : []),
          ];
          return changes.some(
            (change) =>
              change == null ||
              (increase && change <= 0) ||
              (decrease && change >= 0),
          );
        })
      )
        throw new Error("Contradictory financial trend.");
    }
  }
  return content;
}
