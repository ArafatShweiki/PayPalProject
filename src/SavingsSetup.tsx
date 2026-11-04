import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button, PanelHead } from "./ui";
import type { State } from "../shared/types";
import { GoalForm } from "./Wallet";
import type { SavingsDestination, SavingsOptions } from "../shared/circles";
import { money } from "../shared/money";
import { userFacingMessage } from "./errors";
export function SavingsSetup({
  onDone,
  onSkip,
}: {
  onDone: (destination: SavingsDestination) => void | Promise<void>;
  onSkip?: () => void;
}) {
  const [options, setOptions] = useState<SavingsOptions>(),
    [selected, setSelected] = useState(""),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<SavingsOptions>("/savings/options", undefined, "GET", {
      signal: controller.signal,
    })
      .then((v) => {
        if (controller.signal.aborted) return;
        setOptions(v);
        setSelected(
          v.options.some(
            (o) => o.kind === v.destination?.kind && o.id === v.destination?.id,
          )
            ? `${v.destination!.kind}:${v.destination!.id}`
            : "",
        );
        if (!v.options.length) setCreate(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(userFacingMessage(e.message));
      });
    return () => controller.abort();
  }, []);
  async function work(fn: () => Promise<SavingsDestination>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await fn();
      await onDone(saved);
    } catch (e) {
      setError(userFacingMessage((e as Error).message));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="savings-setup">
      <h3>Choose your savings goal</h3>
      <p>Round-ups go directly to this goal, in its currency.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!options && !error && <p role="status">Loading savings goals…</p>}
      {options && !create && (
        <>
          <label>
            Default savings destination
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose a goal</option>
              {(["goal", "circle"] as const).map((kind) => (
                <optgroup
                  key={kind}
                  label={
                    kind === "goal"
                      ? "Personal savings goals"
                      : "Savings Circles"
                  }
                >
                  {options.options
                    .filter((o) => o.kind === kind)
                    .map((o) => (
                      <option
                        key={`${o.kind}:${o.id}`}
                        value={`${o.kind}:${o.id}`}
                      >
                        {o.name} · {o.currency}
                        {o.kind === "circle" ? " · Circle" : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="actions">
            <Button
              disabled={
                busy ||
                !options.options.some((o) => `${o.kind}:${o.id}` === selected)
              }
              onClick={() =>
                void work(() => {
                  const [kind, id] = selected.split(":");
                  return api<SavingsDestination>(
                    "/savings/destination",
                    { kind, id, enable: true },
                    "PUT",
                  );
                })
              }
            >
              {busy ? "Saving…" : "Use this goal"}
            </Button>
            <Button secondary disabled={busy} onClick={() => setCreate(true)}>
              Create a savings goal
            </Button>
          </div>
        </>
      )}
      {create && (
        <GoalForm
          busy={busy}
          requireDefault
          submit={(body) =>
            work(async () => {
              const created = await api<
                Pick<SavingsDestination, "id" | "currency">
              >("/goals", body);
              return {
                kind: "goal",
                id: created.id,
                currency: created.currency,
              };
            })
          }
        />
      )}
      {onSkip && (
        <div className="actions">
          <Button secondary disabled={busy} onClick={onSkip}>
            Continue without a round-up
          </Button>
        </div>
      )}
    </div>
  );
}
export function SavingsDestinationPanel({
  state,
  onChoose,
}: {
  state: State;
  onChoose: () => void;
}) {
  const [options, setOptions] = useState<SavingsOptions>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<SavingsOptions>("/savings/options", undefined, "GET")
      .then((v) => {
        if (active) {
          setOptions(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [state.preferences, state.dashboard]);
  const current = options?.options.find(
    (o) =>
      o.id === state.preferences.savingsDestination?.id &&
      o.kind === state.preferences.savingsDestination.kind,
  );
  return (
    <section className="panel">
      <PanelHead
        title="Savings destination"
        subtitle={
          current
            ? `${current.name} · ${current.currency}`
            : !options && !error
              ? "Loading savings destinations…"
              : "Choose a goal to activate automatic saving."
        }
        action={<Button onClick={onChoose}>Choose savings goal</Button>}
      />
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>
          {state.preferences.savings === "enabled" && current
            ? `Smart Savings is active. Round-ups are credited in ${current.currency}.`
            : "Smart Savings is inactive or awaiting an eligible goal."}
        </p>
      )}
    </section>
  );
}
export function HistoricalSavings({
  onUpdated,
  goalsRevision,
}: {
  onUpdated: () => Promise<void>;
  goalsRevision?: unknown;
}) {
  const [options, setOptions] = useState<SavingsOptions>(),
    [goal, setGoal] = useState(""),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const load = () =>
    api<SavingsOptions>("/savings/options", undefined, "GET").then((value) => {
      setOptions(value);
      setError("");
    });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [goalsRevision]);
  if (!options && error)
    return <p role="alert">Historical savings could not be loaded. {error}</p>;
  if (!options || !Object.values(options.historical).some((v) => Number(v) > 0))
    return null;
  const target = options.options.find(
    (o) => o.kind === "goal" && o.id === goal,
  );
  return (
    <section className="panel">
      <h3>Historical savings to assign</h3>
      <p>
        Your earlier savings are preserved. Assign them to a personal goal in
        the same currency.
      </p>
      <div className="savings-totals">
        {Object.entries(options.historical).map(([c, value]) => (
          <span key={c}>
            {c}: {money(Number(value), c as "USD" | "ILS" | "JOD")}
          </span>
        ))}
      </div>
      {options.reconciliationRequired ? (
        <p role="alert">
          Some historical records need review before assignment. Your funds
          remain recorded.
        </p>
      ) : (
        <>
          <label>
            Personal goal
            <select
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                setConfirm(false);
              }}
            >
              <option value="">Choose a goal</option>
              {options.options
                .filter(
                  (o) =>
                    o.kind === "goal" &&
                    Number(options.historical[o.currency]) > 0,
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.currency}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Amount to assign
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirm(false);
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          {confirm && (
            <p>
              Assign {amount} {target?.currency} to {target?.name}? Your total
              savings stays the same.
            </p>
          )}
          <Button
            disabled={busy || !target || !amount}
            onClick={() => {
              if (!confirm) {
                setConfirm(true);
                return;
              }
              setBusy(true);
              void api("/savings/assign", {
                requestId: crypto.randomUUID(),
                goalId: goal,
                currency: target!.currency,
                amount,
              })
                .then(async () => {
                  await load();
                  await onUpdated();
                  setConfirm(false);
                  setAmount("");
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {confirm ? "Confirm assignment" : "Review assignment"}
          </Button>
        </>
      )}
    </section>
  );
}
