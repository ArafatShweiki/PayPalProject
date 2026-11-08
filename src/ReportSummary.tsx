import { useState } from "react";
import type { Report, State } from "../shared/types";
import { money } from "../shared/money";
import { api } from "./api";
import { Button, Empty, Modal, type Runner } from "./ui";

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
  const [confirm, setConfirm] = useState<string>();
  const candidate = state.recommendations.find(
    (r) => r.id === confirm && r.status === "pending",
  );
  const date = (value: string, timezone = report?.timezone) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: timezone || "UTC",
    });
  const reportTime = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: report?.timezone || "UTC",
    });
  return (
    <div className="report-summary">
      {candidate && (
        <Modal
          title="Confirm savings rule change"
          onClose={() => {
            if (!busy) setConfirm(undefined);
          }}
        >
          <p>
            Change {candidate.currency} round-ups from{" "}
            {money(candidate.current, candidate.currency)} to{" "}
            {money(candidate.suggested, candidate.currency)}. Cap stays{" "}
            {money(candidate.cap, candidate.currency)} per purchase.
          </p>
          <p>
            The historical comparison estimates{" "}
            {money(candidate.additional, candidate.currency)} additional
            savings. Future results depend on purchases and available funds;
            income and bills outside this app are unknown.
          </p>
          <p>
            The server rechecks your settings and ledger revision. If either
            changed, generate a new report.
          </p>
          <div className="actions">
            <Button
              secondary
              disabled={busy}
              onClick={() => setConfirm(undefined)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api(`/recommendations/${candidate.id}`, {
                      decision: "accepted",
                    }),
                  "Suggested rule accepted.",
                ).then((ok) => {
                  if (ok) setConfirm(undefined);
                })
              }
            >
              Confirm rule change
            </Button>
          </div>
        </Modal>
      )}

      {report ? (
        <>
          <header className="report-header">
            <div>
              <p className="report-eyebrow">Financial statement</p>
              <h2>
                {report.frequency === "weekly" ? "Weekly" : "Monthly"} report
              </h2>
              <p className="report-period">
                {date(report.since)} &ndash; {date(periodEnd(report))}
              </p>
            </div>
            <div className="report-meta">
              <span className="report-period-status">
                {report.complete === false
                  ? "Period in progress"
                  : report.complete === true
                    ? "Completed period"
                    : "Recorded period"}
              </span>
              <p>
                Generated{" "}
                <time dateTime={report.at}>
                  {new Date(report.at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: report.timezone || "UTC",
                  })}
                </time>
              </p>
              <p>{report.timezone || "UTC"}</p>
            </div>
          </header>
          <div className="report-totals">
            {report.summaries.map((s) => (
              <article
                key={s.currency}
                aria-label={`${s.currency} financial summary`}
              >
                <div className="report-currency-heading">
                  <h3>{s.currency}</h3>
                  <span>
                    {
                      {
                        ILS: "Israeli shekel",
                        USD: "US dollar",
                        JOD: "Jordanian dinar",
                      }[s.currency]
                    }
                  </span>
                </div>
                <span className="report-amount-label">Total spending</span>
                <h2>{money(s.spending, s.currency)}</h2>
                <dl>
                  <div
                    className={
                      s.savings > 0 ? "report-savings-positive" : undefined
                    }
                  >
                    <dt>Automatic savings</dt>
                    <dd>{money(s.savings, s.currency)}</dd>
                  </div>
                  <div>
                    <dt>Purchases</dt>
                    <dd>{s.count}</dd>
                  </div>
                  {report.savingsBalances && (
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
                    </>
                  )}
                  {s.averageSpending != null && (
                    <div>
                      <dt>Average purchase</dt>
                      <dd>{money(s.averageSpending, s.currency)}</dd>
                    </div>
                  )}
                </dl>
              </article>
            ))}
          </div>
          <section
            className="report-section report-spending"
            aria-label="Spending insights"
          >
            <h3>Spending insights</h3>
            <p className="report-section-intro">
              Currencies are reported separately; no combined currency total.
            </p>
            <div className="report-insights-grid">
              {report.summaries.map((s) => {
                const previous = s.previousSpending;
                const change = previous == null ? null : s.spending - previous;
                return (
                  <div className="report-insight" key={s.currency}>
                    <h4>{s.currency}</h4>
                    {change === null ? (
                      <p>
                        Not enough recorded history for a previous-period
                        comparison.
                      </p>
                    ) : (
                      <>
                        <p className="report-change">
                          <strong>
                            {change === 0
                              ? "No change"
                              : `${money(Math.abs(change), s.currency)} ${change > 0 ? "increase" : "decrease"}`}
                          </strong>
                          {s.spendingChangePercent != null && (
                            <span>
                              {Math.abs(s.spendingChangePercent).toFixed(1)}%{" "}
                              {change === 0
                                ? "change"
                                : change > 0
                                  ? "higher"
                                  : "lower"}
                            </span>
                          )}
                        </p>
                        <p>Previous period: {money(previous!, s.currency)}</p>
                        {previous === 0 && change !== 0 && (
                          <p>
                            Percentage change is unavailable from a zero
                            baseline.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {report.complete === false &&
              report.summaries.some((s) => s.previousSpending != null) && (
                <p className="report-footnote">
                  Comparisons use the same elapsed portion of the previous
                  period.
                </p>
              )}
            <p className="report-footnote">
              Refund-adjusted spending excludes purchases refunded or reversed
              by the reporting cutoff. Automatic savings retain any savings kept
              after a refund.
            </p>
          </section>
          {report.status === "ai_unavailable" && (
            <div className="report-ai-fallback" role="status">
              <strong>AI perspective unavailable</strong>
              <p>
                AI insights could not be generated. Your calculated totals are
                available.
                {report.aiError === "configuration"
                  ? " The AI service needs configuration."
                  : " Please retry using Generate report."}
              </p>
            </div>
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
              className="report-section report-ai"
              aria-label="AI financial insights"
            >
              <div className="report-ai-heading">
                <h3>AI perspective</h3>
                <span>Gemini explanation</span>
              </div>
              <ul className="report-ai-overview">
                {report.aiContent.summary
                  .split(/(?<=[.!?])\s+(?=[A-Z])/)
                  .filter(Boolean)
                  .map((sentence, i) => (
                    <li key={i}>{sentence}</li>
                  ))}
              </ul>
              <div className="report-ai-grid">
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
              </div>
              <p className="report-footnote">
                AI explains the calculated results using recorded activity.
              </p>
            </section>
          )}
          <details className="report-details">
            <summary>Report notes &amp; calculation details</summary>
            <p>
              Reporting cutoff: {reportTime(periodEnd(report))} (
              {report.timezone || "UTC"}). Amounts reflect this saved report,
              including savings balances at cutoff.
            </p>
            {report.observations.map((o, i) => (
              <p key={i}>{o}</p>
            ))}
            <p>
              Generated {reportTime(report.at)}. Purchases refunded by the
              reporting cutoff are excluded.{" "}
              {report.source === "Gemini"
                ? "AI explains the calculated totals."
                : "Locally calculated totals; no AI-generated explanation."}
            </p>
            {report.explanationCache && (
              <p>
                {report.explanationCache.cached ? "Reused" : "Generated"} AI
                explanation: {reportTime(report.explanationCache.generatedAt)}.
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
                <Button disabled={busy} onClick={() => setConfirm(r.id)}>
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
