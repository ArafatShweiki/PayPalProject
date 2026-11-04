import type { Goal, State } from "../shared/types";
import { goalSaved } from "../shared/ledger";
export const goalAmount = (state: State, id: string) =>
  state.dashboard
    ? (state.dashboard.goalTotals[id] ?? 0)
    : goalSaved(state, id);
export const goalProgress = (goal: Goal, saved: number) =>
  goal.target > 0
    ? Math.max(0, Math.min(100, Math.floor((saved / goal.target) * 100)))
    : 0;
