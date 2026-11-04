import { useEffect, useState, useRef } from "react";
import { Bell, ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import type { ComparisonPeriod } from "../shared/currency-insights";
import { api } from "./api";
import { currencies, money, crossRate, type Currency } from "../shared/money";
import type { State, CurrencyInsight as Insight } from "../shared/types";
import {
  Button,
  Empty,
  CurrencySelect,
  PanelHead,
  date,
  time,
  field,
  type Runner,
} from "./ui";
export function CurrencyPerspective({
  state,
  busy,
  run,
}: {
  state: State;
  busy: boolean;
  run: Runner;
}) {
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>("ILS");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<ComparisonPeriod>("available");
  const [insight, setInsight] = useState<Insight | null>(null);
  const revision = useRef(0);
  const latestId = state.snapshots.at(-1)?.id;
  useEffect(() => {
    revision.current++;
    setInsight(null);
  }, [latestId]);
  return (
    <section className="panel">
      <PanelHead
        title="Currency perspective"
        subtitle="Understand what an observed rate means for your selected amount."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const requestedRevision = revision.current;
            const result = await api<Insight>("/rates/insight", {
              from,
              to,
              ...(amount ? { amount } : {}),
              ...(period !== "available" ? { period } : {}),
            });
            if (requestedRevision === revision.current) setInsight(result);
          }, "Currency analysis ready.");
        }}
      >
        <div className="alert-form">
          <label>
            Analyze from
            <CurrencySelect
              name="Insight source"
              value={from}
              onChange={(c) => {
                setFrom(c);
                revision.current++;
                setInsight(null);
              }}
            />
          </label>
          <label>
            Receive in
            <CurrencySelect
              name="Insight target"
              value={to}
              onChange={(c) => {
                setTo(c);
                revision.current++;
                setInsight(null);
              }}
            />
          </label>
          <label>
            Amount (optional)
            <input
              aria-label="Insight amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                revision.current++;
                setInsight(null);
              }}
              placeholder="Use available balance"
            />
          </label>
        </div>
        <label className="perspective-period">
          Comparison period
          <select
            aria-label="Comparison period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as ComparisonPeriod);
              revision.current++;
              setInsight(null);
            }}
          >
            <option value="available">Available history</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </select>
        </label>
        <p className="footnote">
          Leave amount empty to analyze your available{" "}
          {money(state.balances[from], from)}. No funds will move.
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Analyzing…" : "Explain this conversion"}
        </Button>
      </form>
      {insight ? (
        <PerspectiveResult insight={insight} state={state} />
      ) : (
        <p className="footnote">
          Uses recorded observations and calculated values. No funds will move.
        </p>
      )}
    </section>
  );
}
function PerspectiveResult({
  insight: i,
  state,
}: {
  insight: Insight;
  state: State;
}) {
  const expired =
    i.stale ||
    Date.now() - Date.parse(i.observedAt ?? i.fetchedAt) >
      (state.rateStaleMs ?? 36 * 3600000);
  const change = expired ? null : i.changePercent;
  const direction =
    change === null || change === 0 ? "neutral" : change > 0 ? "up" : "down";
  const Icon =
    direction === "up"
      ? ArrowUpRight
      : direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  return (
    <div className="perspective-result">
      <div className="row between">
        <span className="pill">
          {i.source === "Gemini"
            ? "AI-generated explanation"
            : "Calculated explanation · AI unavailable"}
        </span>
        <span className={expired ? "rate-down" : "muted"}>
          {expired ? "Stale quote" : "Available quote"} ·{" "}
          {time(i.observedAt ?? i.fetchedAt)}
        </span>
      </div>
      <div className="perspective-primary">
        <div>
          <p>
            {expired
              ? "Last recorded indicative value"
              : "Current indicative value"}{" "}
            · before fees
          </p>
          <h2>{money(i.received, i.to)}</h2>
          <p>For {money(i.amount, i.from)}</p>
        </div>
        <div className={`movement movement-${direction}`}>
          <p>Rate movement</p>
          <strong>
            <Icon size={22} aria-hidden="true" />
            {change === null
              ? "Unavailable"
              : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}
          </strong>
          <p>
            {change === null
              ? expired
                ? "Refresh rates for a current comparison."
                : "Insufficient history for this period."
              : `${change > 0 ? "Increased" : change < 0 ? "Decreased" : "Unchanged"} since ${time(i.referenceAt!)}`}
          </p>
        </div>
      </div>
      {!expired && i.difference !== null && i.referenceAt && (
        <div className="perspective-impact">
          <h3>What does this mean for you?</h3>
          <p>
            {i.difference === 0
              ? `Your ${money(i.amount, i.from)} has the same indicative value as at ${time(i.referenceAt)}.`
              : `Your ${money(i.amount, i.from)} would get you ${money(Math.abs(i.difference), i.to)} ${i.difference > 0 ? "more" : "less"} than at ${time(i.referenceAt)}, before fees.`}
          </p>
          <p className="muted">
            Compared with the quote at {time(i.observedAt ?? i.fetchedAt)}. This
            is an indicative conversion value, not guaranteed profit.
          </p>
        </div>
      )}
      {!expired && i.referenceAt === null && (
        <p className="muted">
          {i.earliestAt
            ? `Earliest available observation: ${time(i.earliestAt)}.`
            : "No earlier comparison observation is available."}{" "}
          No older prices have been estimated.
        </p>
      )}
      {i.source === "Gemini" && (
        <div className="insight">
          <div>
            {i.observations.slice(0, 2).map((text, n) => (
              <p key={n}>{text}</p>
            ))}
          </div>
        </div>
      )}
      <a
        className="text-link"
        href={i.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        {"View rate source"}
      </a>
      <details className="perspective-details">
        <summary>More details</summary>
        <p>
          {i.observationCount} stored observations. Rate range{" "}
          {(i.minimumRate / 1e6).toFixed(6)} –{" "}
          {(i.maximumRate / 1e6).toFixed(6)} {i.to} per {i.from}.
        </p>
        <p>
          Retrieved {time(i.fetchedAt)}.{" "}
          {i.referenceAt && `Comparison quote: ${time(i.referenceAt)}.`} Values
          use the same source-to-target direction and currency precision.
          Execution fees and spreads are unknown. Wallet exchanges remain
          simulated.
        </p>
        {i.monitorThresholdPercent != null && (
          <p>
            Optional monitoring reference:{" "}
            {i.monitorThresholdPercent.toFixed(2)}%, based on adjacent stored
            movements; not a forecast.
          </p>
        )}
        {i.explanationCache && (
          <p>
            {i.explanationCache.cached ? "Reused" : "Generated"} AI explanation:{" "}
            {time(i.explanationCache.generatedAt)}.
          </p>
        )}
        {i.source === "deterministic" &&
          i.observations.map((text, n) => <p key={n}>{text}</p>)}
      </details>
    </div>
  );
}
export function RateHistory({ state }: { state: State }) {
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>("ILS");
  const values = state.snapshots.map(
    (s) => crossRate(from, to, s.ils) / 1000000,
  );
  const min = Math.min(...values),
    max = Math.max(...values);
  const points = values
    .map(
      (v, i) =>
        `${20 + (i / (values.length - 1)) * 660},${145 - ((v - min) / (max - min || 1)) * 110}`,
    )
    .join(" ");
  return (
    <section className="panel">
      <PanelHead
        title="The story so far"
        subtitle="Only observations actually retrieved and stored by Dream Piggy Bank."
        action={
          <div className="row">
            <CurrencySelect
              name="Chart source"
              value={from}
              onChange={setFrom}
            />
            <CurrencySelect name="Chart target" value={to} onChange={setTo} />
          </div>
        }
      />
      {values.length < 2 ? (
        <Empty>
          Your first observation is a starting point. A chart appears after the
          next scheduled observation.
        </Empty>
      ) : (
        <>
          <svg
            className="chart"
            viewBox="0 0 700 180"
            role="img"
            aria-label={`${from}/${to} stored rate history, minimum ${min}, maximum ${max}`}
          >
            <line x1="20" x2="680" y1="145" y2="145" stroke="#dce3eb" />
            <polyline
              points={points}
              fill="none"
              stroke="#2662a8"
              strokeWidth="3"
            />
            {values.map((v, i) => (
              <circle
                key={i}
                cx={20 + (i / (values.length - 1)) * 660}
                cy={145 - ((v - min) / (max - min || 1)) * 110}
                r="4"
                fill="#2662a8"
              >
                <title>
                  {time(state.snapshots[i].fetchedAt)}: {v.toFixed(6)}
                </title>
              </circle>
            ))}
          </svg>
          <div className="row between muted">
            <span>{date(state.snapshots[0].fetchedAt)}</span>
            <span>
              Range {min.toFixed(6)}–{max.toFixed(6)}
            </span>
            <span>{date(state.snapshots.at(-1)!.fetchedAt)}</span>
          </div>
        </>
      )}
    </section>
  );
}
export function Alerts({
  state,
  busy,
  run,
}: {
  state: State;
  busy: boolean;
  run: Runner;
}) {
  return (
    <section className="panel">
      <PanelHead
        title="Keep an eye on a rate"
        subtitle={"Rate checks, with a 24-hour cooldown after each alert."}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void run(
            () =>
              api("/alerts", {
                requestId: crypto.randomUUID(),
                from: field(f, "from"),
                to: field(f, "to"),
                direction: field(f, "direction"),
                mode: field(f, "mode"),
                threshold: Number(field(f, "threshold")),
                ...(field(f, "watched")
                  ? { watched: field(f, "watched") }
                  : {}),
              }),
            "Rate alert created.",
          );
        }}
      >
        <div className="alert-form">
          <label>
            From
            <CurrencySelect name="from" value={undefined} />
          </label>
          <label>
            To
            <select name="to" defaultValue="USD">
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Movement
            <select name="direction">
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
            </select>
          </label>
          <label>
            Threshold type
            <select name="mode">
              <option value="percent">Percent (%)</option>
              <option value="absolute">Absolute movement</option>
              <option value="target">Target exchange rate</option>
            </select>
          </label>
          <label>
            Threshold
            <input
              name="threshold"
              type="number"
              min="0.000001"
              step="any"
              defaultValue="2"
              required
            />
          </label>
          <label>
            Watched amount (optional)
            <input name="watched" inputMode="decimal" placeholder="500.00" />
          </label>
        </div>
        <Button disabled={busy} type="submit">
          <Bell size={16} />
          Create alert
        </Button>
      </form>
      {state.alerts.map((a) => (
        <div className="alert-row" key={a.id}>
          <div>
            <strong>
              {a.from}/{a.to} · {a.direction} by {a.threshold}
              {a.mode === "percent" ? "%" : ""}
            </strong>
            <small>
              Reference {(a.reference / 1000000).toFixed(6)}
              {a.watched ? ` · Watching ${money(a.watched, a.from)}` : ""}
              {a.lastTriggered
                ? ` · Last triggered ${time(a.lastTriggered)}`
                : " · Waiting for movement"}
            </small>
          </div>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void run(
                () => api(`/alerts/${a.id}`, { enabled: !a.enabled }, "PATCH"),
                "Alert updated.",
              )
            }
          >
            {a.enabled ? "Pause" : "Enable"}
          </Button>
        </div>
      ))}
      <h3 className="section-label">Alert history</h3>
      {state.notices.length ? (
        state.notices.map((n) => (
          <div className="notice" key={n.id}>
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <small>{time(n.at)}</small>
          </div>
        ))
      ) : (
        <p className="muted">No thresholds have been crossed yet.</p>
      )}
    </section>
  );
}
