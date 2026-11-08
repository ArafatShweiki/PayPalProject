import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { Button, PanelHead } from "./ui";
import type { State } from "../shared/types";
import { GoalForm } from "./Wallet";
import type { SavingsDestination, SavingsOptions } from "../shared/circles";
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
  const choiceId = useId();
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
          <fieldset className="destination-picker" disabled={busy}>
            <legend>Default savings destination</legend>
            {(["goal", "circle"] as const).map((kind) => {
              const choices = options.options.filter((o) => o.kind === kind);
              if (!choices.length) return null;
              return (
                <section
                  className="destination-group"
                  key={kind}
                  aria-labelledby={`${choiceId}-${kind}`}
                >
                  <h4 id={`${choiceId}-${kind}`}>
                    {kind === "goal"
                      ? "Personal savings goals"
                      : "Savings Circles"}
                  </h4>
                  <p>
                    {kind === "goal"
                      ? "Save toward a goal of your own."
                      : "Save toward a shared circle goal."}
                  </p>
                  <div className="destination-options">
                    {choices.map((o) => {
                      const value = `${o.kind}:${o.id}`;
                      return (
                        <label className="destination-choice" key={value}>
                          <input
                            type="radio"
                            name={`${choiceId}-destination`}
                            value={value}
                            checked={selected === value}
                            onChange={() => setSelected(value)}
                          />
                          <span className="destination-name">{o.name}</span>
                          <span className="destination-currency">
                            {o.currency}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </fieldset>
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
