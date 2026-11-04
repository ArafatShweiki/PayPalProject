import "../server/env";
import {
  generateReportContent,
  reportModel,
  ReportAIError,
} from "../server/gemini-reports";
import { validateReportContent } from "../server/report-schema";

// Opt-in live smoke test: only anonymous fixture aggregates, never an account's data.
if (!process.argv.includes("--live")) {
  console.error(
    "Pass --live to make a billable Gemini request using server credentials.",
  );
  process.exitCode = 1;
} else {
  try {
    const content = await generateReportContent({
      period: { frequency: "weekly", complete: true, timezone: "UTC" },
      summaries: [
        {
          currency: "ILS",
          count: 1,
          spending: 2340,
          savings: 160,
          previousSpending: null,
          categories: [{ label: "Other", amount: 2340 }],
        },
      ],
      goals: [],
      candidates: [],
    });
    validateReportContent(content, []);
    console.info(
      JSON.stringify({
        liveGemini: "passed",
        model: reportModel(),
        schema: "validated",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        liveGemini: "failed",
        model: reportModel(),
        reason:
          error instanceof ReportAIError ? error.reason : "schema_validation",
        providerStatus:
          error instanceof ReportAIError ? error.providerStatus : undefined,
      }),
    );
    process.exitCode = 1;
  }
}
