import type {
  Report,
  Snapshot,
  Recommendation,
  UserData,
} from "../shared/types";
import { buildReport } from "../shared/reports";
import {
  generateReportContent,
  reportModel,
  ReportAIError,
} from "./gemini-reports";
import { REPORT_PROMPT_VERSION } from "./report-prompt";
import { validateReportContent } from "./report-schema";
import {
  consumeLimit,
  remember,
  setting,
  ServiceError,
  withLease,
  fingerprint,
} from "./reliability";
import { findSavedReport, saveReport } from "./report-storage";
export { buildReport } from "../shared/reports";
export { aiSchema } from "./ai";

export async function explain(
  report: Report,
  _rates: Snapshot[],
  uid?: string,
  revision = "",
  recommendations: Recommendation[] = [],
): Promise<Report> {
  if (
    !report.summaries.some(
      (s) =>
        s.count || s.savings || (report.totalSavings?.[s.currency] ?? 0) > 0,
    )
  )
    return { ...report, status: "empty" };
  const candidates = recommendations.map((r) => ({ ...r, id: r.currency }));
  const facts = {
    savingsBalances: report.savingsBalances,
    generalSavings: report.generalSavings,
    circleSavings: report.circleSavings,
    totalSavings: report.totalSavings,
    period: {
      frequency: report.frequency,
      start: report.since,
      end: report.until,
      complete: report.complete,
      timezone: report.timezone,
    },
    summaries: report.summaries.map((s) => ({
      ...s,
      categories: Object.entries(s.categories).map(([label, amount]) => ({
        label: label.slice(0, 80),
        amount,
      })),
    })),
    goals: report.goals.map(({ currency, target, saved }) => ({
      currency,
      target,
      saved,
    })),
    candidates: candidates.map(
      ({
        id,
        currency,
        current,
        suggested,
        additional,
        cap,
        estimatedSavings,
        recordedSavings,
      }) => ({
        id,
        currency,
        current,
        suggested,
        additional,
        cap,
        estimatedSavings,
        recordedSavings,
      }),
    ),
  };
  try {
    const work = async () => {
      const quota = await consumeLimit(
        "gemini-provider",
        "shared",
        setting("GEMINI_REQUESTS_PER_MINUTE", 30),
      );
      if (!quota.allowed) throw new ReportAIError("quota");
      return withLease(
        "gemini-provider",
        setting("GEMINI_MAX_CONCURRENT", 3),
        async () =>
          validateReportContent(
            await generateReportContent(facts),
            candidates,
            report,
          ),
        60000,
      );
    };
    const cached = await remember(
      `ai:${uid || report.id}:report:${report.frequency}:${report.since}`,
      {
        facts,
        revision,
        model: reportModel(),
        promptVersion: REPORT_PROMPT_VERSION,
      },
      setting("AI_CACHE_TTL_MS", 900000),
      work,
    );
    const content = {
      ...cached.value,
      recommendations: cached.value.recommendations.map((r) => ({
        ...r,
        id: recommendations.find((candidate) => candidate.currency === r.id)!
          .id,
      })),
    };
    return {
      ...report,
      source: "Gemini",
      status: "complete",
      model: reportModel(),
      promptVersion: REPORT_PROMPT_VERSION,
      aiContent: content,
      observations: [
        content.summary,
        ...content.spendingInsights,
        ...content.savingsInsights,
      ],
      explanationCache: {
        generatedAt: cached.generatedAt,
        cached: cached.cached,
      },
    };
  } catch (error) {
    const reason =
      error instanceof ReportAIError
        ? error.reason
        : error instanceof ServiceError
          ? "quota"
          : "invalid_response";
    return {
      ...report,
      status: "ai_unavailable",
      aiError: reason,
      observations: [
        ...report.observations,
        "AI insights could not be generated. Your calculated totals are available; please retry.",
      ],
    };
  }
}

export async function generateSavedReport(
  sub: string,
  uid: string,
  data: UserData,
  frequency: "weekly" | "monthly",
  selected?: string,
  timezone = "UTC",
) {
  const built = buildReport(data, frequency, Date.now(), selected, timezone);
  // Exclude generation timestamps and random IDs. Include actual source revisions,
  // rule settings, goal allocations and reporting boundaries.
  const key = fingerprint({
    frequency,
    start: built.report.since,
    end: built.report.until,
    timezone,
    complete: built.report.complete,
    summaries: built.report.summaries,
    goalProgress: built.report.goals,
    savingsBalances: built.report.savingsBalances,
    circleSavings: built.report.circleSavings,
    generalSavings: built.report.generalSavings,
    totalSavings: built.report.totalSavings,
    ledger: data.ledger.filter(
      (e) =>
        Date.parse(e.at) <=
        Math.min(Date.now(), Date.parse(built.report.until!)),
    ),
    goals: data.goals,
    preferences: {
      savings: data.preferences.savings,
      ruleEnabled: data.savingsRuleEnabled,
      increments: data.preferences.increments,
      caps: data.preferences.caps,
    },
    model: reportModel(),
    promptVersion: REPORT_PROMPT_VERSION,
  });
  const scope = `report-generation:${uid}:${frequency}`;
  const result = await remember(
    scope,
    key,
    setting("AI_CACHE_TTL_MS", 900000),
    async () => {
      const previous = await findSavedReport(sub, key);
      if (previous)
        return {
          ...previous,
          report: {
            ...previous.report,
            explanationCache: { generatedAt: previous.report.at, cached: true },
          },
        };
      let report = await explain(
        built.report,
        [],
        uid,
        key,
        built.recommendations,
      );
      report = {
        ...report,
        inputFingerprint: key,
        model: reportModel(),
        promptVersion: REPORT_PROMPT_VERSION,
      };
      // Only validated model-selected recommendations get AI descriptions. Deterministic
      // simulations remain usable during provider failure and are labeled accordingly.
      const recommendations = built.recommendations;
      const saved = { report, recommendations };
      await saveReport(sub, saved);
      return saved;
    },
    (value) => value.report.status !== "ai_unavailable",
  );
  return result.cached
    ? {
        ...result.value,
        report: {
          ...result.value.report,
          explanationCache: {
            generatedAt: result.value.report.at,
            cached: true,
          },
        },
      }
    : result.value;
}
