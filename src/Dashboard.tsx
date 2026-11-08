import { spendingMovement } from "../shared/spending";
import { SavingsCoach } from "./SavingsCoach";
import { DeferredSection } from "./DeferredSection";
import type { Section } from "./useWalletData";
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
export function SpendingActivity({
  state,
  bare = false,
}: {
  state: State;
  bare?: boolean;
}) {
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
      const day = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
      const amount = state.dashboard
        ? state.dashboard.dailySpending
            .filter((r) => r.currency === currency && r.day === day)
            .reduce((sum, r) => sum + r.amount, 0)
        : state.ledger
            .filter(
              (e) =>
                (e.kind === "purchase" || e.kind === "refund") &&
                e.currency === currency &&
                new Date(e.at) >= start &&
                new Date(e.at) < end,
            )
            .reduce((sum, e) => sum + spendingMovement(e).net, 0);
      return {
        label: start.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        amount,
      };
    });
  }, [state.ledger, state.dashboard, days, currency]);
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.amount)));
  const Card = bare ? "div" : BentoCard;
  return (
    <Card className={bare ? undefined : "bento-half"}>
      <PanelHead
        title="Spending activity"
        subtitle="Net merchant spending - refunds reduce spending"
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
      {buckets.some((b) => b.amount !== 0) ? (
        <div
          className="spending-bars net-spending"
          aria-label="Daily net spending chart"
        >
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
                    height: `${Math.max(b.amount ? 3 : 0, (Math.abs(b.amount) / max) * 48)}%`,
                    bottom: b.amount >= 0 ? "50%" : undefined,
                    top: b.amount < 0 ? "50%" : undefined,
                    background: b.amount < 0 ? "var(--positive)" : undefined,
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
        <Empty>No net spending in this period and currency.</Empty>
      )}
    </Card>
  );
}
export function CurrencyTrends({
  state,
  bare = false,
}: {
  state: State;
  bare?: boolean;
}) {
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
  const Card = bare ? "div" : BentoCard;
  return (
    <Card className={bare ? undefined : "bento-half"}>
      <PanelHead
        title="Currency trends"
        subtitle={
          state.snapshots.at(-1)?.market
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
    </Card>
  );
}
export function Dashboard({
  state,
  display,
  setDisplay,
  onNavigate,
  onCreate,
  onSelect,
  onAddFunds,
  sections,
  onRetrySection,
  marketLoading,
  marketError,
  onRetryMarket,
}: {
  state: State;
  display: Currency;
  setDisplay: (c: Currency) => void;
  onNavigate: (
    page: "My Wallet" | "Smart Savings" | "Currency Rates" | "Reports",
  ) => void;
  onCreate: () => void;
  onAddFunds?: () => void;
  onSelect: (e: Entry) => void;
  sections?: Record<Section, { loading: boolean; error?: unknown }>;
  onRetrySection?: (s: Section) => void;
  marketLoading?: boolean;
  marketError?: unknown;
  onRetryMarket?: () => void;
}) {
  const latest = state.snapshots.at(-1);
  const combined = (balances: State["balances"]) =>
    currencies.every((c) => balances[c] === 0)
      ? 0
      : latest
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
  const inclusiveSavings = { ...state.savingsBalances };
  for (const c of currencies)
    inclusiveSavings[c] += state.dashboard?.circleSavings?.[c] ?? 0;
  const total = combined(state.balances),
    savings = Object.values(inclusiveSavings).every(Number.isSafeInteger)
      ? combined(inclusiveSavings)
      : null;
  const goal =
    state.goals.find(
      (g) =>
        g.id === state.preferences.savingsDestination?.id &&
        !g.archived &&
        goalAmount(state, g.id) < g.target,
    ) ?? state.goals.find((g) => !g.archived);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const spending = state.dashboard
    ? state.dashboard.dailySpending
        .filter((r) => r.currency === display && r.day.startsWith(month))
        .reduce((sum, r) => sum + r.amount, 0)
    : state.ledger
        .filter(
          (e) =>
            e.currency === display &&
            (e.kind === "purchase" || e.kind === "refund") &&
            new Date(e.at).getMonth() === now.getMonth() &&
            new Date(e.at).getFullYear() === now.getFullYear(),
        )
        .reduce((s, e) => s + spendingMovement(e).net, 0);
  const monthlyRows = state.dashboard?.dailySpending.filter(
    (r) => r.currency === display && r.day.startsWith(month),
  );
  const monthlyEntries = state.ledger.filter(
    (e) => e.currency === display && e.at.startsWith(month),
  );
  const gross = monthlyRows
    ? monthlyRows.every((r) => r.gross !== undefined)
      ? monthlyRows.reduce((n, r) => n + r.gross!, 0)
      : null
    : monthlyEntries.reduce((n, e) => n + spendingMovement(e).gross, 0);
  const refunds = monthlyRows
    ? monthlyRows.every((r) => r.refunds !== undefined)
      ? monthlyRows.reduce((n, r) => n + r.refunds!, 0)
      : null
    : monthlyEntries.reduce((n, e) => n + spendingMovement(e).refunds, 0);
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
        {onAddFunds && (
          <button className="text-link" onClick={onAddFunds}>
            Add Funds
          </button>
        )}
        <div className="hero-value">
          {total === null ? "—" : money(total, display)}
        </div>
        <p>
          {latest
            ? `${latest.market ? "Twelve Data quote" : "Indicative midpoint"} · ${time(latest.fetchedAt)}`
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
        <DeferredSection
          label="total savings"
          compact
          {...sections?.overview}
          retry={() => onRetrySection?.("overview")}
        >
          <strong className="metric-value">
            {savings === null ? "—" : money(savings, display)}
          </strong>
        </DeferredSection>
        <small>
          Personal savings plus your own locked Circle shares - indicative{" "}
          {display} value
        </small>
        <span className="pill green">
          {state.preferences.savings === "enabled"
            ? state.preferences.savingsDestination
              ? "Round-ups active"
              : "Setup pending"
            : "Round-ups inactive"}
        </span>
        {link("Explore savings", "Smart Savings")}
      </BentoCard>
      <BentoCard className="metric-card">
        <span className="icon-tile">
          <Wallet size={19} />
        </span>
        <h2>Monthly spending</h2>
        <DeferredSection
          label="monthly spending"
          compact
          {...sections?.overview}
          retry={() => onRetrySection?.("overview")}
        >
          <strong className="metric-value">{money(spending, display)}</strong>
          {gross !== null && refunds !== null && refunds > 0 && (
            <small>
              Purchases {money(gross, display)} - refunds{" "}
              {money(refunds, display)}
            </small>
          )}
        </DeferredSection>
        <small>
          {now.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}{" "}
          · {display} net spending
        </small>
        <p>
          Purchases minus merchant refunds. A negative total means refunds
          exceeded purchases this month.
        </p>
        {link("View activity", "My Wallet")}
      </BentoCard>
      <BentoCard className="bento-half">
        <DeferredSection
          label="spending chart"
          {...sections?.overview}
          retry={() => onRetrySection?.("overview")}
        >
          <SpendingActivity state={state} bare />
        </DeferredSection>
      </BentoCard>
      <BentoCard className="bento-half">
        <DeferredSection
          label="currency trends"
          loading={marketLoading}
          error={marketError}
          retry={onRetryMarket}
        >
          <CurrencyTrends state={state} bare />
        </DeferredSection>
      </BentoCard>
      <SavingsCoach
        state={state}
        compact
        onExplore={() => onNavigate("Smart Savings")}
        onRules={() => onNavigate("Smart Savings")}
      />
      <BentoCard className="bento-half recent-bento">
        <PanelHead
          title="Recent activity"
          subtitle="Your latest wallet movements"
          action={link("View all", "My Wallet")}
        />
        <DeferredSection
          label="recent activity"
          {...sections?.activity}
          retry={() => onRetrySection?.("activity")}
        >
          <Transactions
            entries={state.ledger
              .filter((e) => e.kind !== "opening")
              .slice(-5)
              .reverse()}
            onSelect={onSelect}
          />
        </DeferredSection>
      </BentoCard>
      <BentoCard className="goal-bento bento-half">
        <PanelHead
          title="Savings progress"
          subtitle="A little closer, every day"
          action={<Target size={19} />}
        />
        <DeferredSection
          label="savings progress"
          {...sections?.overview}
          retry={() => onRetrySection?.("overview")}
        >
          {goal ? (
            <>
              <span className="eyebrow">
                {state.preferences.savingsDestination?.id === goal.id &&
                !goal.archived &&
                goalAmount(state, goal.id) < goal.target
                  ? "DEFAULT GOAL"
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
        </DeferredSection>
      </BentoCard>
      <div className="bento-stack bento-half">
        <DeferredSection
          label="alerts and insights"
          {...sections?.overview}
          retry={() => onRetrySection?.("overview")}
        >
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
        </DeferredSection>
      </div>
    </div>
  );
}
