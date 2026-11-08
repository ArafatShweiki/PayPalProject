import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChartNoAxesCombined } from "lucide-react";
import type { State } from "../shared/types";
import {
  coachAdvice,
  strategy,
  type CoachResult,
  type Outlook,
} from "../shared/coach";
import { decimal, minor, money } from "../shared/money";
import { api } from "./api";
import { Button, Empty, PanelHead, date } from "./ui";
import { userFacingMessage } from "./errors";

function Forecast({
  goal,
  asOf,
  alternative,
}: {
  goal: Outlook;
  asOf: string;
  alternative: number;
}) {
  const scenario = strategy(goal.remaining, alternative, asOf);
  const end = Math.min(
    Date.parse(scenario.completion || asOf),
    Date.parse(asOf) + 365 * 86400000,
  );
  const start = Date.parse(goal.start),
    now = Date.parse(asOf);
  const max = Math.max(goal.target, goal.saved, 1);
  const x = (at: string) =>
    30 + ((Date.parse(at) - start) / Math.max(1, end - start)) * 540;
  const y = (n: number) => 150 - Math.min(1, Math.max(0, n / max)) * 125;
  const future = Math.min(
    goal.target,
    goal.saved + Math.round((alternative * (end - now)) / 604800000),
  );
  return (
    <figure className="coach-forecast">
      <svg
        viewBox="0 0 600 160"
        role="img"
        aria-label="Goal savings history and hypothetical projection"
      >
        <title>
          Solid: recorded goal balance. Dashed: hypothetical future savings.
          Dotted: target.
        </title>
        <line
          x1="30"
          x2="570"
          y1={y(goal.target)}
          y2={y(goal.target)}
          stroke="currentColor"
          strokeDasharray="2 5"
        />
        <polyline
          points={goal.history
            .flatMap((p, i) =>
              i
                ? [
                    `${x(p.at)},${y(goal.history[i - 1].amount)}`,
                    `${x(p.at)},${y(p.amount)}`,
                  ]
                : [`${x(p.at)},${y(p.amount)}`],
            )
            .join(" ")}
          fill="none"
          stroke="var(--positive)"
          strokeWidth="3"
        />
        {alternative > 0 && goal.remaining > 0 && (
          <line
            x1={x(asOf)}
            y1={y(goal.saved)}
            x2={x(new Date(end).toISOString())}
            y2={y(future)}
            stroke="var(--accent)"
            strokeWidth="3"
            strokeDasharray="7 5"
          />
        )}
      </svg>
      <div className="forecast-dates">
        <span>{date(goal.start)}</span>
        <span>{date(new Date(end).toISOString())}</span>
      </div>
      <figcaption>
        Solid: recorded balance - Dashed: hypothetical - Dotted:{" "}
        {money(goal.target, goal.currency)} target. Projection shown for up to
        one year.
      </figcaption>
    </figure>
  );
}
function GoalAnalysis({
  goal,
  result,
  onRules,
}: {
  goal: Outlook;
  result: CoachResult;
  onRules: () => void;
}) {
  const [value, setValue] = useState(
    decimal(Math.max(goal.weekly, 0), goal.currency),
  );
  let weekly = 0,
    error = "";
  try {
    weekly =
      value === "0" || /^0\.0+$/.test(value) ? 0 : minor(value, goal.currency);
    if (weekly > 1000000000) throw new Error();
  } catch {
    error = "Enter a weekly amount between zero and 1,000,000,000 minor units.";
  }
  const scenario = strategy(goal.remaining, error ? 0 : weekly, result.asOf);
  return (
    <div className="coach-analysis">
      <div className="coach-metrics">
        <div>
          <small>Recorded goal balance</small>
          <strong>{money(goal.saved, goal.currency)}</strong>
          <span>of {money(goal.target, goal.currency)}</span>
        </div>
        <div>
          <small>Recent average per week</small>
          <strong>
            {goal.status === "estimated"
              ? money(goal.weekly, goal.currency)
              : "?"}
          </strong>
          <span>{goal.daysObserved} full days observed</span>
        </div>
        <div>
          <small>Estimated completion</small>
          <strong>
            {goal.status === "completed"
              ? "Goal reached"
              : goal.completion
                ? date(goal.completion)
                : "Not available"}
          </strong>
          <span>Based on net recorded pace</span>
        </div>
      </div>
      <progress
        aria-label={`${goal.name} progress`}
        max={goal.target}
        value={Math.min(goal.target, goal.saved)}
      />
      <p>{coachAdvice(goal, result.available[goal.currency])}</p>
      {goal.status !== "completed" && goal.status !== "archived" && (
        <>
          <Forecast
            goal={goal}
            asOf={result.asOf}
            alternative={error ? 0 : weekly}
          />
          <div className="coach-comparison">
            <div>
              <h3>Historical pace</h3>
              <p>
                {goal.status === "estimated"
                  ? `${money(goal.weekly, goal.currency)} per week - about ${Math.ceil(goal.weeks!)} weeks remaining`
                  : "No reliable saving pace yet."}
              </p>
              <small>
                Net contributions after recorded reversals. Allocations of
                existing savings do not count as new savings.
              </small>
            </div>
            <div>
              <h3>Explore an alternative</h3>
              <label>
                Hypothetical weekly savings ({goal.currency})
                <input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={!!error}
                />
              </label>
              {error ? (
                <p role="alert">{error}</p>
              ) : (
                <p role="status">
                  {scenario.completion
                    ? `${date(scenario.completion)} - about ${Math.ceil(scenario.weeks!)} weeks`
                    : weekly === 0
                      ? "A zero pace has no completion date."
                      : "Beyond the 100-year projection horizon."}
                </p>
              )}
              <small>
                This scenario changes no settings and assumes a constant pace.
                Available funds, purchases and exchange rates can change.
              </small>
            </div>
          </div>
          <Button secondary onClick={onRules}>
            Review Smart Savings rules
          </Button>
        </>
      )}
    </div>
  );
}
export function SavingsCoach({
  state,
  compact = false,
  onExplore,
  onRules,
  onReports,
}: {
  state: State;
  compact?: boolean;
  onExplore: () => void;
  onRules: () => void;
  onReports?: () => void;
}) {
  const [result, setResult] = useState<CoachResult>(),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(""),
    [explaining, setExplaining] = useState(false);
  const generation = useRef(0);
  // Reload after authoritative overview/activity/balance refresh, never infer from the first activity page.
  useEffect(() => {
    const version = ++generation.current,
      controller = new AbortController();
    setResult(undefined);
    setError("");
    void api<CoachResult>("/savings/coach", undefined, "GET", {
      signal: controller.signal,
    })
      .then((r) => {
        if (!Array.isArray(r?.outlooks))
          throw new Error("The savings outlook response is unavailable.");
        if (!controller.signal.aborted) setResult(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(userFacingMessage(e.message));
      });
    return () => {
      controller.abort();
      if (generation.current === version) generation.current++;
    };
  }, [state.dashboard, state.balances, attempt]);
  const goal =
    result?.outlooks.find((g) => g.id === selected && !g.archived) ??
    result?.outlooks.find((g) => !g.archived && g.remaining > 0) ??
    result?.outlooks.find((g) => !g.archived);
  return (
    <section
      className={
        compact ? "bento-card bento-half coach-summary" : "panel savings-coach"
      }
      aria-label="AI Savings Coach"
    >
      <PanelHead
        title={compact ? "Savings Coach" : "Your savings outlook"}
        subtitle={
          result
            ? `Verified account records - ${date(result.asOf)}`
            : "Goal forecasts from recorded savings"
        }
        action={<ChartNoAxesCombined size={19} />}
      />
      {error ? (
        <div role="alert">
          <p>Your savings outlook could not be loaded. {error}</p>
          <Button secondary onClick={() => setAttempt((n) => n + 1)}>
            Retry savings outlook
          </Button>
        </div>
      ) : !result ? (
        <p role="status">Loading savings outlook...</p>
      ) : !goal ? (
        <Empty>
          Create a personal savings goal to start building a savings outlook.
        </Empty>
      ) : compact ? (
        <>
          <h3>{goal.name}</h3>
          <p>{coachAdvice(goal, result.available[goal.currency])}</p>
          <strong>
            {money(goal.saved, goal.currency)} of{" "}
            {money(goal.target, goal.currency)}
          </strong>
          {goal.completion && (
            <small>
              Estimated completion {date(goal.completion)} - constant historical
              pace
            </small>
          )}
          <button className="text-link" onClick={onExplore}>
            Explore your outlook <ArrowRight size={15} />
          </button>
        </>
      ) : (
        <>
          <label>
            Personal goal
            <select
              value={goal.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {result.outlooks
                .filter((g) => !g.archived)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} - {g.currency}
                  </option>
                ))}
            </select>
          </label>
          <GoalAnalysis
            key={`${goal.id}:${result.asOf}`}
            goal={goal}
            result={result}
            onRules={onRules}
          />
          {!!result.spending?.filter((s) => s.currency === goal.currency)
            .length && (
            <section
              className="coach-explanation"
              aria-label="Recorded spending insights"
            >
              <h3>Where recorded spending goes</h3>
              <p>
                Last 28 days in {goal.currency}. Merchant refunds reduce the
                category they originally belonged to. Activity outside this app
                is unknown.
              </p>
              <div className="spending-evidence">
                {result.spending
                  .filter((s) => s.currency === goal.currency)
                  .sort((a, b) => b.net - a.net)
                  .slice(0, 4)
                  .map((s) => (
                    <article key={s.category}>
                      <strong>{s.category}</strong>
                      <dl>
                        <dt>Net spending</dt>
                        <dd>{money(s.net, s.currency)}</dd>
                        <dt>Purchases</dt>
                        <dd>
                          {money(s.gross, s.currency)} / {s.count} recorded
                        </dd>
                        <dt>Refunds</dt>
                        <dd>{money(s.refunds, s.currency)}</dd>
                        {s.previous !== null && (
                          <>
                            <dt>Change from prior 28 days</dt>
                            <dd>{money(s.net - s.previous, s.currency)}</dd>
                          </>
                        )}
                      </dl>
                    </article>
                  ))}
              </div>
              <p>
                Review the largest recorded categories when choosing a saving
                pace. These figures do not establish what you can afford.
              </p>
            </section>
          )}
          {onReports && (
            <div className="coach-explanation">
              <h3>Review a rule suggestion</h3>
              <p>
                Generate a report to compare round-up rules against recorded
                purchases. Any proposed change shows the current rule, cap and
                estimated effect, and requires your confirmation.
              </p>
              <Button secondary onClick={onReports}>
                Review calculated rule suggestions
              </Button>
            </div>
          )}
          <div className="coach-explanation">
            <h3>AI perspective</h3>
            <p>
              Calculations remain available when Gemini is unavailable. AI
              explains the outlook and cannot change your settings.
            </p>
            {result.explanation && <p>{result.explanation}</p>}
            {result.explanationStatus === "unavailable" && (
              <p role="status">
                AI explanation is unavailable. Your verified calculations remain
                above.
              </p>
            )}
            <Button
              secondary
              disabled={explaining}
              onClick={() => {
                const version = generation.current;
                setExplaining(true);
                void api<CoachResult>("/savings/coach/explain", {})
                  .then((r) => {
                    if (generation.current === version) setResult(r);
                  })
                  .catch(() => {
                    if (generation.current === version)
                      setResult((r) =>
                        r ? { ...r, explanationStatus: "unavailable" } : r,
                      );
                  })
                  .finally(() => setExplaining(false));
              }}
            >
              {explaining ? "Explaining..." : "Explain with Gemini"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
