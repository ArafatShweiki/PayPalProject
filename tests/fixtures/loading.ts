import { buildCoach } from "../../shared/coach";
import type { Bootstrap, OnboardingStatus, State } from "../../shared/types";
import {
  initialUser,
  balances,
  goalSaved,
  generalSavings,
} from "../../shared/ledger";
export function bootstrapFixture(state: State): Bootstrap {
  return {
    onboarding: {
      complete: true,
      fullName: state.preferences.name,
      email: "fixture@example.invalid",
      emailVerified: false,
      preferred: state.preferences.preferred,
      savings: state.preferences.savings,
      notifications: state.preferences.notifications,
    },
    state: { ...state, progressive: true },
  };
}
export function profileBootstrap(status: OnboardingStatus): Bootstrap {
  const data = initialUser();
  const state: State = {
    ...data,
    authMode: "auth0",
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: [],
    capabilities: { firebase: false, paypal: false, gemini: false },
  };
  return { onboarding: status, ...(status.complete ? { state } : {}) };
}
export function loadingResponse(path: string, state: State) {
  if (path === "/savings/coach")
    return buildCoach({
      asOf: new Date().toISOString(),
      goals: state.goals.map((g) => ({ ...g, saved: goalSaved(state, g.id) })),
      samples: state.ledger
        .filter((e) => e.goalId)
        .map((e) => ({
          goalId: e.goalId!,
          at: e.at,
          amount:
            e.allocationDelta ??
            e.postings
              .filter((p) => p.account === "savings")
              .reduce((s, p) => s + p.amount, 0),
          paceAmount: e.allocationDelta
            ? 0
            : e.postings
                .filter((p) => p.account === "savings")
                .reduce((s, p) => s + p.amount, 0),
        })),
      available: state.balances,
      guide: {
        dismissed: state.guide?.dismissed ?? false,
        walletViewed: state.guide?.walletViewed ?? false,
        circlesViewed: state.guide?.circlesViewed ?? false,
      },
      steps: {
        funded: state.ledger.some(
          (e) => e.kind === "funding" && e.status === "COMPLETED",
        ),
        goal: state.goals.length > 0,
        enabled: state.preferences.savings === "enabled",
        purchased: state.ledger.some((e) => e.kind === "purchase"),
      },
    });
  if (path === "/savings/options")
    return {
      destination: state.preferences.savingsDestination ?? null,
      options: state.goals
        .filter((g) => !g.archived && goalSaved(state, g.id) < g.target)
        .map((g) => ({
          ...g,
          kind: "goal",
          saved: String(goalSaved(state, g.id)),
          target: String(g.target),
        })),
      historical: generalSavings(state),
      reconciliationRequired: false,
    };
  if (path === "/bootstrap") return bootstrapFixture(state);
  if (path.startsWith("/dashboard")) {
    const daily = new Map<
      string,
      {
        day: string;
        currency: State["preferences"]["preferred"];
        amount: number;
      }
    >();
    for (const entry of state.ledger.filter((e) => e.kind === "purchase")) {
      const date = new Date(entry.at);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const key = `${day}:${entry.currency}`;
      const row = daily.get(key) || {
        day,
        currency: entry.currency,
        amount: 0,
      };
      row.amount += entry.amount;
      daily.set(key, row);
    }
    return {
      goals: state.goals,
      alerts: state.alerts,
      notices: state.notices,
      reports: state.reports.slice(0, 5),
      reportTotal: state.reports.length,
      recommendations: state.recommendations,
      createdAt: state.createdAt,
      dashboard: {
        circleSavings: state.dashboard?.circleSavings,
        generalSavings: generalSavings(state),
        dailySpending: [...daily.values()],
        goalTotals: Object.fromEntries(
          state.goals.map((goal) => [goal.id, goalSaved(state, goal.id)]),
        ),
      },
    };
  }
  if (path.startsWith("/activity")) {
    const query = new URL(path, "http://fixture").searchParams;
    const offset = Number(query.get("cursor") || 0),
      limit = Number(query.get("limit") || 25);
    const entries = state.ledger
      .filter(
        (e) =>
          e.kind !== "opening" &&
          (!query.has("from") || e.at.slice(0, 10) >= query.get("from")!) &&
          (!query.has("to") || e.at.slice(0, 10) <= query.get("to")!) &&
          (!query.has("currency") ||
            e.currency === query.get("currency") ||
            e.to === query.get("currency")) &&
          (!query.has("category") || e.category === query.get("category")) &&
          (!query.has("savings") || e.saved > 0),
      )
      .slice()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return {
      entries: entries.slice(offset, offset + limit),
      nextCursor:
        offset + limit < entries.length ? String(offset + limit) : null,
    };
  }
  return structuredClone(state);
}
