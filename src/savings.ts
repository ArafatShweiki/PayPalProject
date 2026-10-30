import type { Goal, State } from "../shared/types";
export const goalAmount = (state: State, id: string) =>
  state.ledger
    .filter((e) => e.goalId === id)
    .reduce((sum, e) => sum + (e.kind === "refund" ? -e.saved : e.saved), 0);
export const goalProgress = (goal: Goal, saved: number) =>
  goal.target > 0
    ? Math.max(0, Math.min(100, Math.floor((saved / goal.target) * 100)))
    : 0;
