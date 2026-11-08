import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Laptop,
  Plane,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { Goal, State } from "../shared/types";
import { money } from "../shared/money";
import { Button, Empty, date } from "./ui";
import { goalAmount, goalProgress } from "./savings";
const goalIcon = (goal: Goal) =>
  /trip|vacation|getaway|travel/i.test(goal.name)
    ? Plane
    : /laptop|computer/i.test(goal.name)
      ? Laptop
      : /education|learning|school/i.test(goal.name)
        ? GraduationCap
        : /emergency|fund/i.test(goal.name)
          ? ShieldCheck
          : Target;
export function SavingsCarousel({
  state,
  busy,
  onCreate,
  onDestination,
  onClearDefault,
  onDelete,
  selectedGoalId,
  onInspect,
}: {
  state: State;
  busy: boolean;
  onCreate: () => void;
  onDestination: (goal: Goal) => void;
  onClearDefault?: (goal: Goal) => void;
  onDelete?: (goal: Goal) => void;
  selectedGoalId?: string;
  onInspect?: (id: string) => void;
}) {
  const [selected, setLocalSelected] = useState(
    selectedGoalId ??
      (state.preferences.savingsDestination?.kind === "goal"
        ? state.preferences.savingsDestination.id
        : undefined) ??
      state.goals[0]?.id,
  );
  useEffect(() => {
    if (selectedGoalId) setLocalSelected(selectedGoalId);
  }, [selectedGoalId]);
  const setSelected = (id: string) => {
    setLocalSelected(id);
    onInspect?.(id);
  };
  const rail = useRef<HTMLDivElement>(null);
  const touchScroll = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(
    null,
  );
  const goal = state.goals.find((g) => g.id === selected) ?? state.goals[0];
  const index = goal ? state.goals.indexOf(goal) : 0;
  const currentIndex = useRef(index);
  currentIndex.current = index;
  useEffect(() => {
    const container = rail.current;
    if (!container) return;
    const align = () => {
      const card = container.querySelector<HTMLElement>(
        `[data-goal-index="${currentIndex.current}"]`,
      );
      if (card)
        container.scrollTo({
          left:
            card.offsetLeft -
            container.offsetLeft -
            (container.clientWidth - card.offsetWidth) / 2,
          behavior: "instant",
        });
    };
    align();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(align);
    observer.observe(container);
    return () => observer.disconnect();
  }, [index]);
  const select = (i: number) => {
    const next = state.goals[(i + state.goals.length) % state.goals.length];
    if (!next) return;
    touchScroll.current = false;
    setSelected(next.id);
    const card = rail.current?.querySelector<HTMLElement>(
      `[data-goal-index="${(i + state.goals.length) % state.goals.length}"]`,
    );
    if (card && rail.current)
      rail.current.scrollTo({
        left:
          card.offsetLeft -
          rail.current.offsetLeft -
          (rail.current.clientWidth - card.offsetWidth) / 2,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  if (!goal)
    return (
      <div className="carousel-empty">
        <Empty>No savings goals yet.</Empty>
        <Button onClick={onCreate}>Create goal</Button>
      </div>
    );
  const saved = goalAmount(state, goal.id);
  const eligible = !goal.archived && saved < goal.target;
  const active =
    eligible &&
    state.preferences.savings === "enabled" &&
    state.preferences.savingsDestination?.kind === "goal" &&
    state.preferences.savingsDestination.id === goal.id;
  const Icon = goalIcon(goal);
  return (
    <section
      className="savings-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Savings goals"
    >
      <div className="carousel-toolbar">
        <p>Choose a goal to see your progress.</p>
        <div className="row">
          <small aria-live="polite">
            {index + 1} / {state.goals.length}
          </small>
          <button
            className="icon-button"
            aria-label="Previous goal"
            disabled={state.goals.length < 2}
            onClick={() => select(index - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Next goal"
            disabled={state.goals.length < 2}
            onClick={() => select(index + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      <div
        className="goal-carousel-rail"
        ref={rail}
        onScroll={(e) => {
          if (!touchScroll.current) return;
          const container = e.currentTarget;
          clearTimeout(scrollTimer.current);
          scrollTimer.current = setTimeout(() => {
            if (!touchScroll.current) return;
            touchScroll.current = false;
            const center = container.scrollLeft + container.clientWidth / 2;
            const cards = Array.from(
              container.querySelectorAll<HTMLElement>("[data-goal-index]"),
            );
            const nearest = cards.reduce((a, b) =>
              Math.abs(
                a.offsetLeft -
                  container.offsetLeft +
                  a.offsetWidth / 2 -
                  center,
              ) <
              Math.abs(
                b.offsetLeft -
                  container.offsetLeft +
                  b.offsetWidth / 2 -
                  center,
              )
                ? a
                : b,
            );
            const atEnd =
              container.scrollLeft + container.clientWidth >=
              container.scrollWidth - 2;
            setSelected(
              state.goals[
                atEnd
                  ? state.goals.length - 1
                  : Number(nearest.dataset.goalIndex)
              ].id,
            );
          }, 150);
        }}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? state.goals.length - 1
                  : index + (e.key === "ArrowRight" ? 1 : -1);
            select(next);
            const count = state.goals.length;
            rail.current
              ?.querySelector<HTMLButtonElement>(
                `[data-goal-index="${(next + count) % count}"]`,
              )
              ?.focus({ preventScroll: true });
          }
        }}
        onPointerDown={(e) => {
          drag.current = null;
          touchScroll.current = e.pointerType === "touch";
          if (e.pointerType === "mouse" && e.button === 0)
            drag.current = {
              x: e.clientX,
              scroll: e.currentTarget.scrollLeft,
              moved: false,
            };
        }}
        onPointerMove={(e) => {
          if (!drag.current || e.buttons !== 1) return;
          const distance = e.clientX - drag.current.x;
          if (Math.abs(distance) > 6) {
            drag.current.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.scrollLeft = drag.current.scroll - distance;
          }
        }}
        onPointerUp={(e) => {
          if (drag.current?.moved) {
            const cards = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                "[data-goal-index]",
              ),
            );
            const center =
              e.currentTarget.scrollLeft + e.currentTarget.clientWidth / 2;
            const closest = cards.reduce((a, b) =>
              Math.abs(
                a.offsetLeft -
                  e.currentTarget.offsetLeft +
                  a.offsetWidth / 2 -
                  center,
              ) <
              Math.abs(
                b.offsetLeft -
                  e.currentTarget.offsetLeft +
                  b.offsetWidth / 2 -
                  center,
              )
                ? a
                : b,
            );
            select(Number(closest.dataset.goalIndex));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
          drag.current = null;
        }}
      >
        {state.goals.map((g, i) => {
          const amount = goalAmount(state, g.id);
          const CardIcon = goalIcon(g);
          return (
            <button
              key={g.id}
              type="button"
              data-goal-index={i}
              className={`carousel-goal tone-${i % 3} ${g.id === goal.id ? "is-selected" : ""}`}
              aria-pressed={g.id === goal.id}
              aria-label={`Inspect ${g.name}`}
              aria-controls="selected-goal-details"
              onClick={() => select(i)}
            >
              <span className="row between">
                <span className="goal-illustration">
                  <CardIcon size={27} />
                </span>
                <span className="pill">{g.currency}</span>
              </span>
              <span className="carousel-goal-name">{g.name}</span>
              <span className="carousel-goal-amount">
                {money(amount, g.currency)}
              </span>
              <small>of {money(g.target, g.currency)}</small>
              <progress
                aria-label={`${g.name} savings`}
                value={Math.min(g.target, Math.max(0, amount))}
                max={g.target}
              />
              <span className="row between">
                <small>{goalProgress(g, amount)}% saved</small>
                <small>
                  {g.id === goal.id ? "Viewing goal" : "Inspect goal"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="goal-details"
        id="selected-goal-details"
        aria-live="polite"
      >
        <div className="goal-details-heading">
          <span className="icon-tile">
            <Icon size={23} />
          </span>
          <div>
            <span className="eyebrow">SELECTED GOAL · {goal.currency}</span>
            <h3>{goal.name}</h3>
          </div>
          {(active || goal.archived || saved >= goal.target) && (
            <span className={active ? "pill green" : "pill"}>
              {active
                ? "Default goal"
                : goal.archived
                  ? "Archived"
                  : "Completed"}
            </span>
          )}
        </div>
        <div className="goal-details-stats">
          <div>
            <small>Saved so far</small>
            <strong>{money(saved, goal.currency)}</strong>
          </div>
          <div>
            <small>Target amount</small>
            <strong>{money(goal.target, goal.currency)}</strong>
          </div>
          <div>
            <small>Still to save</small>
            <strong>
              {money(Math.max(0, goal.target - saved), goal.currency)}
            </strong>
          </div>
          <div>
            <small>Progress</small>
            <strong>{goalProgress(goal, saved)}%</strong>
          </div>
        </div>
        <progress
          aria-label="Selected goal progress"
          value={Math.min(goal.target, Math.max(0, saved))}
          max={goal.target}
        />
        <div className="goal-details-footer">
          <small>
            Created {date(goal.createdAt)}
            {goal.targetDate
              ? ` · Target ${date(goal.targetDate)}`
              : " · No target date"}
          </small>
          {eligible && !active && (
            <Button disabled={busy} onClick={() => onDestination(goal)}>
              {busy ? "Saving…" : "Set as default savings goal"}
            </Button>
          )}
          {(eligible || onDelete) && (
            <details className="goal-menu">
              <summary>Goal options</summary>
              <div className="actions">
                {active && onClearDefault && (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => onClearDefault(goal)}
                  >
                    Pause Smart Savings
                  </Button>
                )}
                {onDelete && (
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => onDelete(goal)}
                  >
                    Delete goal
                  </Button>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
