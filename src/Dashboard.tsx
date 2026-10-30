import { snapshotRate, observationTime } from "../shared/market";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  ChartNoAxesCombined,
  Leaf,
  Target,
  Wallet,
} from "lucide-react";
import { currencies, money, convert, type Currency } from "../shared/money";
import type { State, Entry } from "../shared/types";
import { CurrencySelect, Empty, PanelHead, date, time } from "./ui";
import { Transactions } from "./Wallet";
import { goalAmount, goalProgress } from "./savings";

export function BentoCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`bento-card ${className}`}>{children}</section>;
}
export function SpendingActivity({ state }: { state: State }) {
  const [days, setDays] = useState(7);
  const [currency, setCurrency] = useState<Currency>(
    state.preferences.preferred,
  );
  const buckets = useMemo(() => {
    const now = new Date();
    return Array.from({ length: days }, (_, i) => {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - days + 1 + i,
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const amount = state.ledger
        .filter(
          (e) =>
            e.kind === "purchase" &&
            e.currency === currency &&
            new Date(e.at) >= start &&
            new Date(e.at) < end,
        )
        .reduce((sum, e) => sum + e.amount, 0);
      return {
        label: start.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        amount,
      };
    });
  }, [state.ledger, days, currency]);
  const max = Math.max(1, ...buckets.map((b) => b.amount));
  return (
    <BentoCard className="bento-half">
      <PanelHead
        title="Spending activity"
        subtitle="Recorded purchases · refunds shown in activity"
        action={<ChartNoAxesCombined size={19} />}
      />
      <div className="chart-controls">
        <label>
          Period
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
        <label>
          Currency
          <CurrencySelect
            name="Spending currency"
            value={currency}
            onChange={setCurrency}
          />
        </label>
        <strong>
          {money(
            buckets.reduce((sum, b) => sum + b.amount, 0),
            currency,
          )}
        </strong>
      </div>
      {buckets.some((b) => b.amount > 0) ? (
        <div className="spending-bars" aria-label="Daily spending chart">
          {buckets.map((b, i) => (
            <button
              key={b.label}
              className="spending-bar"
              aria-label={`${b.label}: ${money(b.amount, currency)}`}
            >
              <span className="bar-tooltip" role="tooltip">
                {b.label}
                <br />
                {money(b.amount, currency)}
              </span>
              <span className="bar-track">
                <span
                  style={{
                    height: `${Math.max(b.amount ? 3 : 0, (b.amount / max) * 100)}%`,
                  }}
                />
              </span>
              <small>
                {i === 0 || i === buckets.length - 1 || days === 7
                  ? b.label
                  : ""}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <Empty>No purchases in this period and currency.</Empty>
      )}
    </BentoCard>
  );
}
export function CurrencyTrends({ state }: { state: State }) {
  const [pair, setPair] = useState("USD/ILS");
  const [from, to] = pair.split("/") as [Currency, Currency];
  const snapshots = useMemo(
    () =>
      state.snapshots
        .slice()
        .sort(
          (a, b) =>
            Date.parse(observationTime(a)) - Date.parse(observationTime(b)),
        ),
    [state.snapshots],
  );
  const values = snapshots.map((s) => snapshotRate(s, from, to) / 1e6);
  const [point, setPoint] = useState<number | null>(null);
  const last = values.at(-1);
  const delta =
    values.length > 1 ? ((last! - values[0]) / values[0]) * 100 : null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const x = (i: number) => 15 + (i / Math.max(1, values.length - 1)) * 570;
  const y = (v: number) => 115 - ((v - min) / (max - min || 1)) * 85;
  const index =
    point !== null && point < values.length ? point : values.length - 1;
  return (
    <BentoCard className="bento-half">
      <PanelHead
        title="Currency trends"
        subtitle={
          state.authMode === "demo" && state.demoMarketMode !== "live"
            ? "Simulated sample observations"
            : state.snapshots.at(-1)?.market
              ? "Twelve Data stored market observations"
              : "Stored PMA midpoint observations"
        }
        action={
          <select
            aria-label="Trend currency pair"
            value={pair}
            onChange={(e) => {
              setPair(e.target.value);
              setPoint(null);
            }}
          >
            {["USD/ILS", "USD/JOD", "JOD/ILS"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        }
      />
      {last === undefined ? (
        <Empty>No rate observations yet.</Empty>
      ) : (
        <>
          <div className="trend-summary">
            <strong>
              {last.toFixed(4)}{" "}
              <small>
                {to} per 1 {from}
              </small>
            </strong>
            <span
              className={delta !== null && delta < 0 ? "rate-down" : "rate-up"}
            >
              {delta === null
                ? "Insufficient comparison history"
                : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`}
              <small>Across stored observations</small>
            </span>
          </div>
          {values.length > 1 ? (
            <>
              <svg
                className="trend-chart"
                viewBox="0 0 600 140"
                role="img"
                aria-label={`${pair} stored rate history`}
              >
                <path
                  d="M15 30H585 M15 72H585 M15 115H585"
                  stroke="#e9eef4"
                  fill="none"
                />
                <polyline
                  points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                  fill="none"
                  stroke="#296ca4"
                  strokeWidth="3"
                />
                {values.map((v, i) => (
                  <circle
                    key={snapshots[i].id}
                    cx={x(i)}
                    cy={y(v)}
                    r="5"
                    fill="#296ca4"
                    tabIndex={0}
                    aria-label={`${time(observationTime(snapshots[i]))}: ${v.toFixed(6)}`}
                    onFocus={() => setPoint(i)}
                    onMouseEnter={() => setPoint(i)}
                  >
                    <title>
                      {time(observationTime(snapshots[i]))}: {v.toFixed(6)}
                    </title>
                  </circle>
                ))}
              </svg>
              <small className="rate-observation" aria-live="polite">
                {time(observationTime(snapshots[index]))} ·{" "}
                {values[index].toFixed(6)} {to}
              </small>
            </>
          ) : (
            <p className="chart-placeholder">
              History appears after another observation.
            </p>
          )}
          <small>
            Last retrieved {time(snapshots.at(-1)!.fetchedAt)}
            {Date.now() - Date.parse(observationTime(snapshots.at(-1)!)) >
            (state.rateStaleMs ?? 36 * 3600000)
              ? " · Stale observation"
              : ""}
            {snapshots.at(-1)?.market
              ? ` ? Quote time ${time(observationTime(snapshots.at(-1)!))}`
              : ". Publication time unavailable."}
          </small>
        </>
      )}
    </BentoCard>
  );
}
export function Dashboard({
  state,
  display,
  setDisplay,
  onNavigate,
  onCreate,
  onSelect,
}: {
  state: State;
  display: Currency;
  setDisplay: (c: Currency) => void;
  onNavigate: (
    page: "My Wallet" | "Smart Savings" | "Currency Rates" | "Reports",
  ) => void;
  onCreate: () => void;
  onSelect: (e: Entry) => void;
}) {
  const latest = state.snapshots.at(-1);
  const combined = (balances: State["balances"]) =>
    latest
      ? currencies.reduce(
          (sum, c) =>
            sum +
            (balances[c] > 0
              ? convert(
                  balances[c],
                  c,
                  display,
                  snapshotRate(latest, c, display),
                )
              : 0),
          0,
        )
      : null;
  const total = combined(state.balances),
    savings = combined(state.savingsBalances);
  const goal =
    state.goals.find((g) => g.id === state.preferences.goalIds[display]) ??
    state.goals[0];
  const now = new Date();
  const spending = state.ledger
    .filter(
      (e) =>
        e.currency === display &&
        e.kind === "purchase" &&
        new Date(e.at).getMonth() === now.getMonth() &&
        new Date(e.at).getFullYear() === now.getFullYear(),
    )
    .reduce((s, e) => s + e.amount, 0);
  const report = state.reports[0];
  const link = (label: string, page: Parameters<typeof onNavigate>[0]) => (
    <button className="text-link" onClick={() => onNavigate(page)}>
      {label}
      <ArrowRight size={15} />
    </button>
  );
  return (
    <div className="bento-grid">
      <BentoCard className="wallet-hero bento-half">
        <div className="row between">
          <span className="eyebrow">TOTAL WALLET VALUE · AVAILABLE</span>
          <CurrencySelect
            name="Dashboard reference currency"
            value={display}
            onChange={setDisplay}
          />
        </div>
        <div className="hero-value">
          {total === null ? "—" : money(total, display)}
        </div>
        <p>
          {latest
            ? `${state.authMode === "demo" && state.demoMarketMode !== "live" ? "Simulated midpoint" : latest.market ? "Twelve Data quote" : "Indicative midpoint"} · ${date(latest.fetchedAt)}`
            : "Refresh currency rates to calculate a combined value."}
        </p>
        <div className="wallet-balances">
          {currencies.map((c) => (
            <div key={c}>
              <small>{c} available</small>
              <strong>{money(state.balances[c], c)}</strong>
            </div>
          ))}
        </div>
        {link("View wallet", "My Wallet")}
      </BentoCard>
      <BentoCard className="metric-card">
        <span className="icon-tile">
          <Leaf size={19} />
        </span>
        <h2>Total Smart Savings</h2>
        <strong className="metric-value">
          {savings === null ? "—" : money(savings, display)}
        </strong>
        <small>Indicative value in {display}</small>
        <span className="pill green">
          {state.preferences.savings === "enabled"
            ? "Round-ups active"
            : "Round-ups inactive"}
        </span>
        {link("Explore savings", "Smart Savings")}
      </BentoCard>
      <BentoCard className="metric-card">
        <span className="icon-tile">
          <Wallet size={19} />
        </span>
        <h2>Monthly spending</h2>
        <strong className="metric-value">{money(spending, display)}</strong>
        <small>
          {now.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}{" "}
          · {display} purchases
        </small>
        <p>See how everyday purchases add up.</p>
        {link("View activity", "My Wallet")}
      </BentoCard>
      <SpendingActivity state={state} />
      <CurrencyTrends state={state} />
      <BentoCard className="bento-half recent-bento">
        <PanelHead
          title="Recent activity"
          subtitle="Your latest wallet movements"
          action={link("View all", "My Wallet")}
        />
        <Transactions
          entries={state.ledger
            .filter((e) => e.kind !== "opening")
            .slice(-5)
            .reverse()}
          onSelect={onSelect}
        />
      </BentoCard>
      <BentoCard className="goal-bento">
        <PanelHead
          title="Savings progress"
          subtitle="A little closer, every day"
          action={<Target size={19} />}
        />
        {goal ? (
          <>
            <span className="eyebrow">
              {state.preferences.goalIds[goal.currency] === goal.id
                ? "ACTIVE DESTINATION"
                : "SAVINGS GOAL"}{" "}
              · {goal.currency}
            </span>
            <h3>{goal.name}</h3>
            <strong className="metric-value">
              {goalProgress(goal, goalAmount(state, goal.id))}%
            </strong>
            <progress
              aria-label={`${goal.name} progress`}
              value={Math.min(
                goal.target,
                Math.max(0, goalAmount(state, goal.id)),
              )}
              max={goal.target}
            />
            <small>
              {money(goalAmount(state, goal.id), goal.currency)} of{" "}
              {money(goal.target, goal.currency)}
            </small>
            {link("Inspect goal", "Smart Savings")}
          </>
        ) : (
          <>
            <Empty>No savings goals yet.</Empty>
            <button className="text-link" onClick={onCreate}>
              Create goal <ArrowRight size={15} />
            </button>
          </>
        )}
      </BentoCard>
      <div className="bento-stack">
        <BentoCard>
          <PanelHead
            title="Rate alerts"
            subtitle={`${state.alerts.filter((a) => a.enabled).length} active alerts`}
            action={<Bell size={17} />}
          />
          <p>
            {state.notices.find((n) => !n.read)?.title ??
              "Keep the rates that matter in view."}
          </p>
          {link("Manage alerts", "Currency Rates")}
        </BentoCard>
        <BentoCard>
          <PanelHead
            title="Latest insights"
            subtitle={
              report
                ? `${report.source === "Gemini" ? "AI explanation" : "Calculated summary"} · ${date(report.at)}`
                : "Grounded in your activity"
            }
          />
          <p>
            {report?.observations[0] ??
              "Generate a report to understand your spending and saving habits."}
          </p>
          {link("Open reports", "Reports")}
        </BentoCard>
      </div>
    </div>
  );
}
