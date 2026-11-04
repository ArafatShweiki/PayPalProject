import type { Report, State } from "../shared/types";
import { money } from "../shared/money";
import { api } from "./api";
import { Button, Empty, time, type Runner } from "./ui";

const periodEnd = (report: Report) =>
  new Date(
    Math.min(
      Date.parse(report.at),
      report.until ? Date.parse(report.until) - 1 : Infinity,
    ),
  ).toISOString();

export function ReportSummary({
  state,
  report,
  busy,
  run,
}: {
  state: State;
  report?: Report;
  busy: boolean;
  run: Runner;
}) {
  const date = (value: string, timezone = report?.timezone) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: timezone || "UTC",
    });
  return (
    <div className="report-summary">
      {report ? (
        <>
          <div className="row between report-meta">
            <span>
              {date(report.since)} – {date(periodEnd(report))}
              {report.timezone ? ` · ${report.timezone}` : ""}
              {report.complete === false ? " · Period in progress" : ""}
            </span>
            <span className="pill">
              {report.source === "Gemini"
                ? "AI explanation"
                : "Calculated summary"}
            </span>
          </div>
          {report.status === "ai_unavailable" && (
            <p role="status">
              AI insights could not be generated. Your calculated totals are
              available.
              {report.aiError === "configuration"
                ? " The AI service needs configuration."
                : " Please retry using Generate report."}
            </p>
          )}
          <div className="report-totals">
            {report.summaries.map((s) => (
              <article key={s.currency}>
                <h3>{s.currency}</h3>
                <span>Total spending</span>
                <h2>{money(s.spending, s.currency)}</h2>
                <dl>
                  <div>
                    <dt>Automatic savings</dt>
                    <dd>{money(s.savings, s.currency)}</dd>
                  </div>
                  <div>
                    <dt>Purchases</dt>
                    <dd>{s.count}</dd>
                  </div>
                  {report.savingsBalances && report.generalSavings && (
                    <>
                      <div>
                        <dt>Savings balance at cutoff</dt>
                        <dd>
                          {money(
                            (report.totalSavings ?? report.savingsBalances)[
                              s.currency
                            ],
                            s.currency,
                          )}
                        </dd>
                      </div>
                      {report.circleSavings && (
                        <div>
                          <dt>Your locked circle savings</dt>
                          <dd>
                            {money(
                              report.circleSavings[s.currency],
                              s.currency,
                            )}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Historical unassigned savings</dt>
                        <dd>
                          {money(report.generalSavings[s.currency], s.currency)}
                        </dd>
                      </div>
                    </>
                  )}
                  {s.averageSpending != null && (
                    <div>
                      <dt>Average purchase</dt>
                      <dd>{money(s.averageSpending, s.currency)}</dd>
                    </div>
                  )}
                </dl>
                {s.previousSpending !== null && (
                  <p className="report-comparison">
                    Previous period {money(s.previousSpending, s.currency)}
                    {s.spendingChangePercent != null &&
                      ` · ${s.spendingChangePercent >= 0 ? "+" : ""}${s.spendingChangePercent.toFixed(1)}%`}
                  </p>
                )}
              </article>
            ))}
          </div>
          {report.summaries.every((s) => s.previousSpending === null) && (
            <p>Not enough recorded history for a previous-period comparison.</p>
          )}
          {report.complete === false &&
            report.summaries.some((s) => s.previousSpending !== null) && (
              <p>
                Comparisons use the same elapsed portion of the previous period.
              </p>
            )}
          {!!report.goals.length && (
            <section className="report-section">
              <h3>Savings goals</h3>
              <div className="report-goals">
                {report.goals.map((g, i) => (
                  <article key={i}>
                    <h4>{g.name}</h4>
                    <p>
                      <strong>{money(g.saved, g.currency)}</strong> /{" "}
                      {money(g.target, g.currency)}
                    </p>
                    <progress
                      aria-label={`${g.name} progress`}
                      value={Math.min(g.saved, g.target)}
                      max={g.target}
                    />
                    <span>
                      {g.progressPercent ??
                        Math.floor((g.saved / g.target) * 100)}
                      %
                    </span>
                  </article>
                ))}
              </div>
            </section>
          )}
          {report.summaries.some((s) => Object.keys(s.categories).length) && (
            <section className="report-section">
              <h3>Spending by category</h3>
              <div className="report-categories">
                {report.summaries
                  .filter((s) => Object.keys(s.categories).length)
                  .map((s) => (
                    <article key={s.currency}>
                      <h4>{s.currency}</h4>
                      {Object.entries(s.categories).map(
                        ([category, amount]) => (
                          <div className="category-row" key={category}>
                            <div className="row between">
                              <span>{category}</span>
                              <strong>{money(amount, s.currency)}</strong>
                            </div>
                            <progress
                              aria-label={`${s.currency} ${category} spending`}
                              value={amount}
                              max={s.spending}
                            />
                          </div>
                        ),
                      )}
                    </article>
                  ))}
              </div>
            </section>
          )}
          {report.aiContent && (
            <section
              className="report-section"
              aria-label="AI financial insights"
            >
              <h3>Financial overview</h3>
              <p>{report.aiContent.summary}</p>
              {(
                [
                  ["Spending insights", report.aiContent.spendingInsights],
                  ["Savings performance", report.aiContent.savingsInsights],
                  ["Next steps", report.aiContent.nextSteps],
                ] as const
              ).map(
                ([title, items]) =>
                  items.length > 0 && (
                    <div key={title}>
                      <h4>{title}</h4>
                      <ul>
                        {items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </section>
          )}
          <details className="report-details">
            <summary>
              {report.source === "Gemini"
                ? "AI explanation and report details"
                : "Report details"}
            </summary>
            {report.observations.map((o, i) => (
              <p key={i}>{o}</p>
            ))}
            <p>
              Generated {time(report.at)}. Purchases refunded by the reporting
              cutoff are excluded.{" "}
              {report.source === "Gemini"
                ? "AI explains the calculated totals."
                : "Locally calculated totals; no AI-generated explanation."}
            </p>
            {report.explanationCache && (
              <p>
                {report.explanationCache.cached ? "Reused" : "Generated"} AI
                explanation: {time(report.explanationCache.generatedAt)}.
              </p>
            )}
          </details>
        </>
      ) : (
        <Empty>
          Generate a report to review your recorded purchases and savings.
        </Empty>
      )}
      {state.recommendations
        .filter((r) => r.status === "pending" && r.reportId === report?.id)
        .map((r) => {
          const origin = state.reports.find((p) => p.id === r.reportId);
          return (
            <article className="recommendation" key={r.id}>
              <h3>Suggested savings adjustment · {r.currency}</h3>
              {report?.aiContent?.recommendations.find(
                (item) => item.id === r.id,
              )?.description && (
                <p>
                  {
                    report.aiContent.recommendations.find(
                      (item) => item.id === r.id,
                    )!.description
                  }
                </p>
              )}
              <p>
                {report?.source === "Gemini" &&
                report.aiContent?.recommendations.some(
                  (item) => item.id === r.id,
                )
                  ? "AI explanation of a calculated historical estimate."
                  : "Calculated historical estimate."}
              </p>
              <dl className="recommendation-values">
                <div>
                  <dt>Current rule</dt>
                  <dd>{money(r.current, r.currency)}</dd>
                </div>
                <div>
                  <dt>Suggested rule</dt>
                  <dd>{money(r.suggested, r.currency)}</dd>
                </div>
                <div>
                  <dt>Estimated additional savings</dt>
                  <dd>+{money(r.additional, r.currency)}</dd>
                </div>
                {r.recordedSavings !== undefined && (
                  <div>
                    <dt>Recorded savings</dt>
                    <dd>{money(r.recordedSavings, r.currency)}</dd>
                  </div>
                )}
                {r.estimatedSavings !== undefined && (
                  <div>
                    <dt>Estimated savings with suggested rule</dt>
                    <dd>{money(r.estimatedSavings, r.currency)}</dd>
                  </div>
                )}
              </dl>
              <p>
                Based on{" "}
                {origin
                  ? `purchases from ${date(origin.since, origin.timezone)} to ${date(periodEnd(origin), origin.timezone)}`
                  : "the linked report’s purchases"}
                . Future savings depend on purchases and available funds.
              </p>
              <details>
                <summary>Rule details</summary>
                <p>
                  Round-ups remain capped at {money(r.cap, r.currency)} per
                  purchase. This estimate uses the report’s purchases and saved
                  cap; it is not a forecast.
                </p>
              </details>
              <div className="actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api(`/recommendations/${r.id}`, {
                          decision: "accepted",
                        }),
                      "Suggested rule accepted.",
                    )
                  }
                >
                  Accept rule
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api(`/recommendations/${r.id}`, {
                          decision: "dismissed",
                        }),
                      "Recommendation dismissed.",
                    )
                  }
                >
                  Dismiss
                </Button>
              </div>
            </article>
          );
        })}
    </div>
  );
}
