import type { Report, State } from "../shared/types";
import { money } from "../shared/money";
import { api } from "./api";
import { Button, Empty, date, time, type Runner } from "./ui";

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
  return (
    <div className="report-summary">
      {report ? (
        <>
          <div className="row between report-meta">
            <span>
              {date(report.since)} – {date(report.at)}
            </span>
            <span className="pill">
              {report.source === "Gemini"
                ? "AI explanation"
                : "Calculated summary"}
            </span>
          </div>
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
                    <span>{Math.floor((g.saved / g.target) * 100)}%</span>
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
              Generated {time(report.at)}. Refunded purchases excluded.{" "}
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
        .filter((r) => r.status === "pending")
        .map((r) => {
          const origin = state.reports.find((p) => p.id === r.reportId);
          return (
            <article className="recommendation" key={r.id}>
              <h3>Suggested savings adjustment · {r.currency}</h3>
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
              </dl>
              <p>
                Based on{" "}
                {origin
                  ? `purchases from ${date(origin.since)} to ${date(origin.at)}`
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
