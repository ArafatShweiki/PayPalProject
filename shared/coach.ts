import type { Currency } from "./money.js";
import type { Goal } from "./types.js";

export type GoalSample = {
  goalId: string;
  at: string;
  amount: number;
  paceAmount: number;
};
export type SpendingInsight = {
  currency: Currency;
  category: string;
  gross: number;
  refunds: number;
  net: number;
  previous: number | null;
  count: number;
};
export type CoachInput = {
  spending?: SpendingInsight[];
  asOf: string;
  goals: (Goal & { saved: number })[];
  samples: GoalSample[];
  available: Record<Currency, number>;
  guide: { dismissed: boolean; walletViewed: boolean; circlesViewed: boolean };
  steps: {
    funded: boolean;
    goal: boolean;
    enabled: boolean;
    purchased: boolean;
  };
};
export type Outlook = Goal & {
  saved: number;
  remaining: number;
  weekly: number;
  daysObserved: number;
  netContributions: number;
  contributionDays: number;
  start: string;
  status: "completed" | "archived" | "insufficient" | "stalled" | "estimated";
  completion: string | null;
  weeks: number | null;
  history: { at: string; amount: number }[];
};
const DAY = 86400000;
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function strategy(remaining: number, weekly: number, asOf: string) {
  if (
    ![remaining, weekly].every(Number.isSafeInteger) ||
    remaining < 0 ||
    weekly < 0
  )
    throw new Error("Use nonnegative whole minor units.");
  if (!remaining) return { weeks: 0, completion: asOf };
  if (!weekly) return { weeks: null, completion: null };
  const days = Number(ceil(BigInt(remaining) * 7n, BigInt(weekly)));
  return {
    weeks: days / 7,
    completion:
      days <= 36525
        ? new Date(Date.parse(asOf) + days * DAY).toISOString()
        : null,
  };
}
export function goalOutlook(
  input: CoachInput,
  goal: CoachInput["goals"][number],
): Outlook {
  const now = Date.parse(input.asOf);
  const start = Math.max(Date.parse(goal.createdAt), now - 56 * DAY);
  const elapsedMs = Math.max(0, now - start);
  const daysObserved = Math.floor(elapsedMs / DAY);
  const samples = input.samples
    .filter(
      (s) =>
        s.goalId === goal.id &&
        Date.parse(s.at) >= start &&
        Date.parse(s.at) <= now,
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sum = (key: "amount" | "paceAmount") =>
    samples.reduce((n, s) => n + BigInt(s[key]), 0n);
  const net = sum("paceAmount");
  if (
    net > BigInt(Number.MAX_SAFE_INTEGER) ||
    net < BigInt(-Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Savings pace exceeds supported precision.");
  const contributionDays = new Set(
    samples
      .filter((s) => s.paceAmount > 0)
      .map((s) => new Date(s.at).toISOString().slice(0, 10)),
  ).size;
  const contributions = samples.filter((s) => s.paceAmount > 0).length;
  const remaining = Math.max(0, goal.target - goal.saved);
  const status = goal.archived
    ? "archived"
    : !remaining
      ? "completed"
      : daysObserved < 14 || contributions < 3 || contributionDays < 2
        ? "insufficient"
        : net <= 0n
          ? "stalled"
          : "estimated";
  const weekly =
    status === "estimated"
      ? Number(
          (net * BigInt(7 * DAY) + BigInt(elapsedMs) / 2n) / BigInt(elapsedMs),
        )
      : 0;
  // Use unrounded historical net pace for the date. Display rounding never changes the forecast.
  const days =
    status === "estimated"
      ? Number(ceil(BigInt(remaining) * BigInt(elapsedMs), net * BigInt(DAY)))
      : null;
  let running = BigInt(goal.saved) - sum("amount");
  const history = [
    { at: new Date(start).toISOString(), amount: Number(running) },
    ...samples.map((s) => {
      running += BigInt(s.amount);
      return { at: s.at, amount: Number(running) };
    }),
    { at: input.asOf, amount: goal.saved },
  ];
  return {
    ...goal,
    remaining,
    weekly,
    daysObserved,
    contributionDays,
    netContributions: Number(net),
    start: new Date(start).toISOString(),
    status,
    completion:
      status === "completed"
        ? input.asOf
        : days !== null && days <= 36525
          ? new Date(now + days * DAY).toISOString()
          : null,
    weeks: days === null ? null : days / 7,
    history,
  };
}
export type CoachResult = CoachInput & {
  outlooks: Outlook[];
  explanation?: string;
  explanationStatus?: "ready" | "unavailable";
};
export function buildCoach(input: CoachInput): CoachResult {
  return { ...input, outlooks: input.goals.map((g) => goalOutlook(input, g)) };
}
export function coachAdvice(goal: Outlook, available: number) {
  if (goal.status === "completed")
    return "Your goal is fully funded. Review your next savings destination.";
  if (goal.status === "archived")
    return "This goal is archived. Its recorded savings are preserved.";
  if (available <= 0)
    return "No available funds are recorded in this goal's currency. Review your wallet before planning additional savings.";
  if (goal.status === "insufficient")
    return "Not enough savings history to estimate a completion date yet.";
  if (goal.status === "stalled")
    return "Recent net contributions are zero or negative. Review withdrawals and reversals before setting a new pace.";
  if (
    goal.targetDate &&
    goal.completion &&
    goal.completion.slice(0, 10) > goal.targetDate
  )
    return "Your recorded pace reaches this goal after its target date. Compare a different pace or review the deadline.";
  return "Keep reviewing your recorded saving pace. Compare an alternative below before deciding whether to change your rules.";
}
