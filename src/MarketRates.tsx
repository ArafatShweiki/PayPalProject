import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Radio } from "lucide-react";
import type { MarketStatus, Snapshot, State } from "../shared/types";
import { type Currency } from "../shared/money";
import {
  historyPeriods,
  isQuoteStale,
  observationTime,
  pairStatus,
  pairTime,
  rateMethod,
  snapshotRate,
  type HistoryPeriod,
} from "../shared/market";
import { api } from "./api";
import { userFacingMessage } from "./errors";
import { Button, CurrencySelect, Empty, PanelHead, time } from "./ui";
import { CardSkeleton } from "./Skeleton";
export function MarketRatesPanel({
  state,
  status,
  busy,
  onRefresh,
}: {
  state: State;
  status?: MarketStatus;
  busy: boolean;
  onRefresh: () => void;
}) {
  const latest = state.snapshots.at(-1),
    prior = state.snapshots.at(-2);
  return (
    <section className="panel">
      <PanelHead
        title={"Forex market observations"}
        subtitle={
          status?.provider === "Twelve Data"
            ? `Twelve Data · quotes checked every ${Math.round(status.pollMs / 1000)} seconds`
            : "PMA indicative observations · configure Twelve Data for automatic Forex prices"
        }
        action={
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Button secondary disabled={busy} onClick={onRefresh}>
              {"Refresh rates"}
            </Button>
          </div>
        }
      />
      {
        <p
          className={`market-connection ${status?.connection === "unavailable" ? "rate-down" : ""}`}
          role="status"
        >
          <Radio size={15} aria-hidden="true" />
          {status?.connection === "connected"
            ? "Rate updates connected"
            : status?.connection === "unavailable"
              ? "Market feed unavailable"
              : "Connecting to rate updates"}
          {status?.error && ` · ${userFacingMessage(status.error)}`}
        </p>
      }
      {status?.lastSuccessAt && (
        <small>Last successful retrieval {time(status.lastSuccessAt)}</small>
      )}
      {status?.nextAttemptAt && (
        <small>
          Next eligible provider check {time(status.nextAttemptAt)}. Provider
          quote times determine freshness.
        </small>
      )}
      {!latest ? (
        <Empty>
          No market observations available. Configure the provider or wait for a
          successful update.
        </Empty>
      ) : (
        <>
          <div className="forex-pairs">
            {(
              [
                ["USD", "ILS"],
                ["USD", "JOD"],
                ["JOD", "ILS"],
                ["ILS", "USD"],
                ["JOD", "USD"],
                ["ILS", "JOD"],
              ] as [Currency, Currency][]
            ).map(([from, to]) => {
              const current = snapshotRate(latest, from, to),
                previous = prior ? snapshotRate(prior, from, to) : null,
                delta = previous === null ? null : current - previous;
              const stale = isQuoteStale(
                  latest,
                  from,
                  to,
                  state.rateStaleMs ?? 36 * 3600000,
                ),
                market = pairStatus(latest, from, to);
              const Icon =
                delta === null || delta === 0
                  ? ArrowRight
                  : delta > 0
                    ? ArrowUpRight
                    : ArrowDownRight;
              return (
                <article className="forex-pair" key={from + to}>
                  <div className="row between">
                    <h3>
                      {from}/{to}
                    </h3>
                    {
                      <span className="pill">
                        {stale ? "Stale quote" : "Available quote"}
                      </span>
                    }
                  </div>
                  <strong className="forex-value">
                    {(current / 1e6).toFixed(6)}
                  </strong>
                  <p
                    className={
                      delta !== null && delta < 0 ? "rate-down" : "rate-up"
                    }
                  >
                    <Icon size={16} aria-hidden="true" />
                    {delta === null
                      ? "No comparison observation"
                      : `${delta > 0 ? "+" : ""}${(delta / 1e6).toFixed(6)} (${delta > 0 ? "+" : ""}${((delta / previous!) * 100).toFixed(3)}%) · ${delta > 0 ? "up" : delta < 0 ? "down" : "unchanged"}`}
                  </p>
                  <small>
                    Previous recorded{" "}
                    {previous === null
                      ? "unavailable"
                      : (previous / 1e6).toFixed(6)}
                  </small>
                  {<small>{rateMethod(latest, from, to)}</small>}
                  <small>Quote time {time(pairTime(latest, from, to))}</small>
                  <small>
                    Market {market}
                    {latest.market
                      ? " · provider status"
                      : " · not supplied by source"}
                  </small>
                </article>
              );
            })}
          </div>
          <p className="footnote">
            {latest.market
              ? "Twelve Data minute quotes; cross-rates combine the two timestamped provider legs. USD/JOD is pegged and may remain unchanged. No movement is generated by this application."
              : "PMA publishes indicative bid/ask observations; retrieval time is not publication time."}{" "}
            No fee or spread is applied; real execution costs are unknown.
          </p>
          <a
            className="text-link"
            href={latest.source}
            target="_blank"
            rel="noreferrer"
          >
            {latest.market
              ? "Market data by Twelve Data"
              : "View official PMA source"}
            <ArrowUpRight size={15} />
          </a>
        </>
      )}
    </section>
  );
}
export function MarketHistory({ state }: { state: State }) {
  const [from, setFrom] = useState<Currency>("USD"),
    [to, setTo] = useState<Currency>("ILS"),
    [period, setPeriod] = useState<HistoryPeriod>("24h");
  const [history, setHistory] = useState<{
      key: string;
      points: Snapshot[];
      error?: string;
    }>(),
    [loading, setLoading] = useState(false);
  const latestId = state.snapshots.at(-1)?.id,
    key = `${state.authMode}:${period}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api<{
      snapshots: Snapshot[];
    }>(`/rates/history?period=${period}`)
      .then((result) => {
        if (active) setHistory({ key, points: result.snapshots });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (active)
          setHistory((current) => ({
            key,
            points: current?.key === key ? current.points : [],
            error: "Historical observations are temporarily unavailable.",
          }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.authMode, period, latestId, key]);
  const cutoff = Date.now() - historyPeriods[period].ms;
  const points = (history?.key === key ? history.points : []).filter(
    (s) => Date.parse(observationTime(s)) >= cutoff,
  );
  const values = points.map((s) => snapshotRate(s, from, to) / 1e6),
    min = Math.min(...values),
    max = Math.max(...values);
  const times = points.map((s) => Date.parse(pairTime(s, from, to))),
    start = Math.min(...times),
    end = Math.max(...times);
  const x = (i: number) => 20 + ((times[i] - start) / (end - start || 1)) * 660,
    y = (v: number) => 145 - ((v - min) / (max - min || 1)) * 110;
  return (
    <section className="panel">
      <PanelHead
        title="The story so far"
        subtitle={
          "Actual stored observations only; unavailable periods are never backfilled with invented prices."
        }
        action={
          <div className="row history-controls">
            <CurrencySelect
              name="Chart source"
              value={from}
              onChange={setFrom}
            />
            <CurrencySelect name="Chart target" value={to} onChange={setTo} />
            <select
              aria-label="History period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as HistoryPeriod)}
            >
              <option value="1h">1 hour</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
            </select>
          </div>
        }
      />
      {history?.key === key && history.error && (
        <p role="status">{history.error}</p>
      )}
      {loading && points.length === 0 ? (
        <div role="status" aria-label="Loading rate history">
          <CardSkeleton kind="chart" />
        </div>
      ) : values.length < 2 ? (
        <Empty>
          No usable history for this period and currency pair. At least two
          stored observations are required.
        </Empty>
      ) : (
        <>
          <svg
            className="chart"
            viewBox="0 0 700 180"
            role="img"
            aria-label={`${from}/${to} stored rate history`}
          >
            <path
              d="M20 35H680 M20 90H680 M20 145H680"
              stroke="#e5ebf1"
              fill="none"
            />
            <polyline
              points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke="#2662a8"
              strokeWidth="3"
            />
            {values.map((v, i) => (
              <circle
                key={points[i].id}
                cx={x(i)}
                cy={y(v)}
                r="3"
                fill="#2662a8"
                tabIndex={0}
                aria-label={`${time(pairTime(points[i], from, to))}: ${v.toFixed(6)}`}
              >
                <title>
                  {time(pairTime(points[i], from, to))}: {v.toFixed(6)}
                </title>
              </circle>
            ))}
          </svg>
          <div className="row between muted">
            <small>{time(new Date(start).toISOString())}</small>
            <small>
              {values.length} stored observations · {min.toFixed(6)}–
              {max.toFixed(6)}
            </small>
            <small>{time(new Date(end).toISOString())}</small>
          </div>
          <small>
            Coverage is limited to stored points in this period; this is not a
            complete provider history.
          </small>
        </>
      )}
    </section>
  );
}
