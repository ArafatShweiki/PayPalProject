import {
  snapshotRate,
  pairTime,
  isQuoteStale,
  rateMethod,
  historyPeriods,
  type HistoryPeriod,
} from "../../shared/market";
import { z } from "zod";
import {
  append,
  balances,
  idempotent,
  purchase,
  refund,
  goalSaved,
  generalSavings,
} from "../../shared/ledger";
import { currencies, convert, minor, roundUp } from "../../shared/money";
import { buildReport } from "../../shared/reports";
import { currencyFacts } from "../../shared/currency-insights";
import type { Snapshot, State, UserData } from "../../shared/types";
import { fundedUser } from "./user";
const FIXTURE_STORAGE_KEY = "test-wallet-fixture";
const currency = z.enum(currencies);
const amount = z.string().max(20);
const id = z.string().min(1).max(128);
const requestId = z.string().uuid();
const conversion = z.object({ from: currency, to: currency, amount });
const numbers = z.object({
  ILS: z.number().int().min(1).max(100000),
  USD: z.number().int().min(1).max(100000),
  JOD: z.number().int().min(1).max(1000000),
});
const now = () => new Date().toISOString();
function sampleSnapshot(index: number): Snapshot {
  return {
    id: crypto.randomUUID(),
    fetchedAt: new Date(Date.now() - (6 - index) * 3600000).toISOString(),
    publishedAt: null,
    source: "https://www.pma.ps/",
    ils: {
      ILS: 1000000,
      USD: 3500000 + index * 10000,
      JOD: 4940000 + index * 14000,
    },
    quotes: [
      {
        pair: "USD/ILS (simulated)",
        bid: ((3500000 + index * 10000) / 1e6 - 0.01).toFixed(3),
        ask: ((3500000 + index * 10000) / 1e6 + 0.01).toFixed(3),
      },
      {
        pair: "JOD/ILS (simulated)",
        bid: ((4940000 + index * 14000) / 1e6 - 0.01).toFixed(3),
        ask: ((4940000 + index * 14000) / 1e6 + 0.01).toFixed(3),
      },
    ],
  };
}
function seed(): UserData {
  const data = fundedUser();
  data.preferences.name = "Alex (Fixture)";
  data.preferences.savings = "enabled";
  data.profile = {
    fullName: "Alex (Fixture)",
    email: "alex@example.invalid",
    emailVerified: false,
    completedAt: now(),
  };
  for (const [currency, name, target] of [
    ["ILS", "Weekend getaway", 200000],
    ["USD", "New laptop", 150000],
    ["JOD", "Learning fund", 300000],
  ] as const) {
    const goal = {
      id: crypto.randomUUID(),
      currency,
      name,
      target,
      createdAt: now(),
    };
    data.goals.push(goal);
    data.preferences.goalIds[currency] = goal.id;
  }
  for (const [currency, value, name, category] of [
    ["ILS", 2340, "Sample corner coffee", "Food & drink"],
    ["ILS", 12870, "Sample groceries", "Shopping"],
    ["USD", 4295, "Sample books", "Education"],
    ["JOD", 7850, "Sample taxi", "Transport"],
  ] as const)
    purchase(data, currency, value, name, category);
  data.notices.push({
    id: crypto.randomUUID(),
    at: now(),
    title: "Welcome to Developer Fixture Mode",
    body: "Wallet balances, transactions and savings are simulated. Choose real Forex or sample rates in Currency Rates. Your wallet activity stays in this tab.",
    read: false,
  });
  const result = buildReport(data, "monthly");
  result.report.observations.unshift(
    "Sample savings insight using local calculations. No live AI request was made.",
  );
  data.reports.push(result.report);
  data.recommendations.push(...result.recommendations);
  const selected = data.goals.find((g) => g.currency === "ILS")!;
  data.preferences.savingsDestination = {
    kind: "goal",
    id: selected.id,
    currency: selected.currency,
  };
  return data;
}
// Only the fixed read-only public market client is allowed. Financial operations remain local.
export function createWalletFixture() {
  let data: UserData;
  let snapshots: Snapshot[] = [];
  let marketMode: "live" | "sample" = "sample";
  const staleMs = 600000;
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(FIXTURE_STORAGE_KEY) || "null",
    );
    if (!saved?.data?.profile || !Array.isArray(saved.snapshots))
      throw new Error();
    data = saved.data;
    marketMode = "sample";
    snapshots = marketMode === "sample" ? saved.snapshots : [];
  } catch {
    data = seed();
    snapshots = [0, 3, 6].map(sampleSnapshot);
  }
  const persist = () =>
    sessionStorage.setItem(
      FIXTURE_STORAGE_KEY,
      JSON.stringify({
        data,
        snapshots: marketMode === "sample" ? snapshots : [],
        marketMode,
      }),
    );
  persist();
  function fixtureInsight(body: unknown, points = snapshots) {
    const b = conversion
      .partial({ amount: true })
      .extend({ period: z.enum(["available", "24h", "7d", "30d"]).optional() })
      .parse(body);
    return currencyFacts(
      points,
      b.from,
      b.to,
      b.amount ? minor(b.amount, b.from) : balances(data)[b.from],
      marketMode === "live" ? staleMs : 36 * 3600000,
      b.period,
    );
  }
  const state = (): State => ({
    ...data,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots,
    capabilities: { firebase: false, paypal: false, gemini: false },
    authMode: "auth0",

    rateStaleMs: 36 * 3600000,
  });
  function quote(body: unknown) {
    const b = conversion.parse(body);
    if (b.from === b.to) throw new Error("Select two different currencies.");
    const s = snapshots.at(-1);
    if (
      !s ||
      isQuoteStale(
        s,
        b.from,
        b.to,
        marketMode === "live" ? staleMs : 36 * 3600000,
      )
    )
      throw new Error(
        marketMode === "live"
          ? "Real Forex is unavailable or stale. Refresh rates or explicitly select sample data."
          : "Refresh simulated rates first.",
      );
    const value = minor(b.amount, b.from);
    const rate = snapshotRate(s, b.from, b.to);
    const received = convert(value, b.from, b.to, rate);
    if (!received)
      throw new Error(
        "Amount is too small to receive a target currency minor unit.",
      );
    return {
      amount: value,
      rate,
      received,
      snapshotId: s.id,
      fetchedAt: s.fetchedAt,
      source: s.source,
      observedAt: pairTime(s, b.from, b.to),
      method: rateMethod(s, b.from, b.to),
      simulatedFee: 0,
      simulatedSpread: 0,
      expiresAt: new Date(
        Math.min(
          Date.now() + (marketMode === "live" ? 60000 : 5 * 60000),
          Date.parse(pairTime(s, b.from, b.to)) +
            (marketMode === "live" ? staleMs : 36 * 3600000),
        ),
      ).toISOString(),
    };
  }
  function evaluateFixtureAlerts(s: Snapshot) {
    if (
      isQuoteStale(
        s,
        "USD",
        "ILS",
        marketMode === "live" ? staleMs : 36 * 3600000,
      )
    )
      return;
    for (const a of data.alerts) {
      if (!a.enabled || a.lastSnapshotId === s.id) continue;
      a.lastSnapshotId = s.id;
      const rate = snapshotRate(s, a.from, a.to);
      const delta =
        a.mode === "percent"
          ? ((rate - a.reference) / a.reference) * 100
          : (rate - a.reference) / 1e6;
      const previous = a.lastObserved ?? a.reference;
      a.lastObserved = rate;
      const target = a.threshold * 1e6;
      const hit =
        a.mode === "target"
          ? a.direction === "increase"
            ? previous < target && rate >= target
            : previous > target && rate <= target
          : a.direction === "increase"
            ? delta >= a.threshold
            : delta <= -a.threshold;
      if (
        !hit ||
        (a.lastTriggered && Date.now() - Date.parse(a.lastTriggered) < 86400000)
      )
        continue;
      if (data.preferences.notifications)
        data.notices.unshift({
          id: crypto.randomUUID(),
          at: now(),
          title: `Fixture wallet ${a.from}/${a.to} alert`,
          body:
            marketMode === "live"
              ? "Recorded real Forex crossed your local fixture threshold. Wallet funds remain simulated."
              : "Sample rate crossed your configured threshold. No live market data was requested.",
          read: false,
        });
      a.reference = rate;
      a.lastTriggered = now();
    }
  }
  const quotes = new Map<string, import("../../shared/circles").SavingsQuote>();
  const options = () => ({
    destination: data.preferences.savingsDestination ?? null,
    options: data.goals
      .filter((g) => !g.archived && goalSaved(data, g.id) < g.target)
      .map((g) => ({
        ...g,
        kind: "goal",
        saved: String(goalSaved(data, g.id)),
        target: String(g.target),
      })),
    historical: generalSavings(data),
    reconciliationRequired: false,
  });
  function handle(path: string, body: unknown, method: string) {
    if (path === "/guide") {
      data.guide = { ...data.guide, ...(body as object) };
      return data.guide;
    }
    if (path === "/savings/options") return options();
    if (path === "/savings/destination") {
      const b = z
        .object({ kind: z.literal("goal"), id, enable: z.boolean() })
        .parse(body);
      const g = data.goals.find(
        (g) => g.id === b.id && !g.archived && goalSaved(data, g.id) < g.target,
      );
      if (!g) throw new Error("Choose a savings goal before saving.");
      data.preferences.savingsDestination = {
        kind: "goal",
        id: g.id,
        currency: g.currency,
      };
      data.preferences.savings = b.enable ? "enabled" : "disabled";
      return data.preferences.savingsDestination;
    }
    if (path === "/savings/preview") {
      const b = z
        .object({ currency, amount, purchase: z.boolean().default(false) })
        .parse(body);
      const value = minor(b.amount, b.currency),
        saved = b.purchase
          ? data.preferences.savings === "enabled"
            ? roundUp(
                value,
                data.preferences.increments[b.currency],
                data.preferences.caps[b.currency],
              )
            : 0
          : value;
      if (!saved) return { quote: null, saved: 0 };
      const g = data.goals.find(
        (g) =>
          g.id === data.preferences.savingsDestination?.id &&
          !g.archived &&
          goalSaved(data, g.id) < g.target,
      );
      if (!g) throw new Error("Choose a savings goal before saving.");
      const rate =
        b.currency === g.currency
          ? 1000000
          : snapshotRate(snapshots.at(-1)!, b.currency, g.currency);
      const q = {
        id: crypto.randomUUID(),
        source_currency: b.currency,
        source_minor: saved,
        target_currency: g.currency,
        target_minor: convert(saved, b.currency, g.currency, rate),
        rate_units: rate,
        source: "Explicit test fixture",
        observed_at: now(),
        expires_at: new Date(Date.now() + 120000).toISOString(),
        fee_minor: 0,
        destination_kind: "goal" as const,
        destination_id: g.id,
      };
      quotes.set(q.id, q);
      return { saved, quote: q };
    }
    if (path === "/circles" && method === "GET") return [];

    if (path === "/state" && body === undefined) return state();
    if (path === "/rates/live")
      return {
        snapshots,
        status: {
          provider: "Unknown",
          configured: true,
          transport: "polling",
          pollMs: 21600000,
          staleMs: 36 * 3600000,
          connection: "connected",
        },
      };
    if (path.startsWith("/rates/history?")) {
      const period = new URLSearchParams(path.split("?")[1]).get(
        "period",
      ) as HistoryPeriod;
      if (!historyPeriods[period])
        throw new Error("Choose a supported history period.");
      return {
        snapshots: snapshots.filter(
          (s) =>
            Date.parse(s.publishedAt ?? s.fetchedAt) >=
            Date.now() - historyPeriods[period].ms,
        ),
      };
    }
    if (path.startsWith("/paypal"))
      throw new Error(
        "PayPal operations are disabled in Developer Fixture Mode.",
      );
    if (path === "/purchases" && method === "POST") {
      const b = z
        .object({
          requestId,
          currency,
          amount,
          description: z.string(),
          category: z.string(),
          quoteId: z.string().nullable().optional(),
          skipSavings: z.boolean().default(false),
        })
        .parse(body);
      return idempotent(
        data,
        b.requestId,
        JSON.stringify({ ...b, quoteId: undefined }),
        () => {
          const value = minor(b.amount, b.currency),
            saved =
              data.preferences.savings === "enabled" && !b.skipSavings
                ? roundUp(
                    value,
                    data.preferences.increments[b.currency],
                    data.preferences.caps[b.currency],
                  )
                : 0;
          const q = quotes.get(b.quoteId || "");
          if (
            saved &&
            (!q || q.source_minor !== saved || q.source_currency !== b.currency)
          )
            throw new Error("Choose a savings goal before saving.");
          const entry = {
            id: crypto.randomUUID(),
            at: now(),
            kind: "purchase" as const,
            currency: b.currency,
            amount: value,
            saved,
            description: b.description,
            category: b.category,
            goalId: saved ? q!.destination_id : undefined,
            saving: saved ? q : undefined,
            postings: [
              {
                currency: b.currency,
                account: "available" as const,
                amount: -value - saved,
              },
              {
                currency: b.currency,
                account: "external" as const,
                amount: value + saved,
              },
              ...(saved
                ? [
                    {
                      currency: q!.target_currency,
                      account: "external" as const,
                      amount: -q!.target_minor,
                    },
                    {
                      currency: q!.target_currency,
                      account: "savings" as const,
                      amount: q!.target_minor,
                    },
                  ]
                : []),
            ],
          };
          append(data, entry);
          return entry;
        },
      );
    }
    if (path === "/refunds" && method === "POST") {
      const b = z.object({ requestId, id }).parse(body);
      return idempotent(data, b.requestId, JSON.stringify(b), () =>
        refund(data, b.id),
      );
    }
    if (path === "/preferences" && method === "PUT") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(60),
          preferred: currency,
          savings: z.enum(["unseen", "enabled", "disabled"]),
          increments: numbers,
          caps: numbers,
          goalIds: z.object({
            ILS: id.nullable().optional(),
            USD: id.nullable().optional(),
            JOD: id.nullable().optional(),
          }),
          frequency: z.enum(["weekly", "monthly"]),
          notifications: z.boolean(),
        })
        .partial()
        .parse(body);
      const next = { ...data.preferences, ...b };
      for (const c of currencies)
        if (
          next.goalIds[c] &&
          !data.goals.some((g) => g.id === next.goalIds[c] && g.currency === c)
        )
          throw new Error("Select a goal in the matching currency.");
      data.preferences = next;
      data.profile!.fullName = next.name;
      return next;
    }
    if (path === "/savings/default" && method === "PUT") {
      const b = z.object({ currency, goalId: id.nullable() }).parse(body);
      const goal = data.goals.find(
        (g) =>
          g.id === b.goalId &&
          g.currency === b.currency &&
          !g.archived &&
          goalSaved(data, g.id) < g.target,
      );
      if (b.goalId && !goal)
        throw new Error("Select an eligible goal in the matching currency.");
      data.preferences.goalIds[b.currency] = b.goalId;
      return data.preferences.goalIds;
    }
    if (path.startsWith("/goals/") && method === "DELETE") {
      const goal = data.goals.find((g) => g.id === path.slice(7));
      if (!goal) throw new Error("Select an owned goal.");
      const saved = goalSaved(data, goal.id);
      if (saved > 0)
        append(data, {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: "adjustment",
          currency: goal.currency,
          amount: saved,
          saved: 0,
          goalId: goal.id,
          description: `Deleted goal: ${goal.name}`,
          category: "Savings",
          postings: [
            { currency: goal.currency, account: "savings", amount: -saved },
            { currency: goal.currency, account: "available", amount: saved },
          ],
        });
      data.goals = data.goals.filter((g) => g.id !== goal.id);
      if (data.preferences.goalIds[goal.currency] === goal.id)
        delete data.preferences.goalIds[goal.currency];
      if (
        data.preferences.savingsDestination?.kind === "goal" &&
        data.preferences.savingsDestination.id === goal.id
      ) {
        data.preferences.savingsDestination = null;
        data.preferences.savings = "disabled";
      }
      return { deleted: true };
    }
    if (path === "/goals" && method === "POST") {
      const b = z
        .object({
          requestId,
          currency,
          amount,
          name: z.string().trim().min(1).max(60),
          makeDefault: z.boolean().default(false),
          targetDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .parse(body);
      return idempotent(data, b.requestId, JSON.stringify(b), () => {
        if (data.goals.length >= 25) throw new Error("Maximum 25 goals.");
        const g = {
          id: crypto.randomUUID(),
          name: b.name,
          currency: b.currency,
          target: minor(b.amount, b.currency),
          createdAt: now(),
          targetDate: b.targetDate,
        };
        data.goals.push(g);
        if (b.makeDefault) {
          data.preferences.savingsDestination = {
            kind: "goal",
            id: g.id,
            currency: g.currency,
          };
          data.preferences.savings = "enabled";
        }
        return g;
      });
    }
    if (path === "/conversions/preview") return quote(body);
    if (path === "/conversions" && method === "POST") {
      const b = conversion
        .extend({
          requestId,
          snapshotId: id,
          rate: z.number().int().positive(),
          expiresAt: z.iso.datetime(),
        })
        .parse(body);
      return idempotent(data, b.requestId, JSON.stringify(b), () => {
        const q = quote(b);
        if (
          Date.parse(b.expiresAt) < Date.now() ||
          Date.parse(b.expiresAt) > Date.now() + 301000 ||
          q.rate !== b.rate
        )
          throw new Error("Preview expired or rate changed. Preview again.");
        const e = {
          id: crypto.randomUUID(),
          at: now(),
          kind: "conversion" as const,
          currency: b.from,
          amount: q.amount,
          saved: 0,
          to: b.to,
          received: q.received,
          rate: q.rate,
          snapshotId: q.snapshotId,
          quoteSource: q.source,
          observedAt: q.observedAt,
          method: q.method,
          simulatedFee: 0,
          simulatedSpread: 0,
          description: `Simulated ${b.from} to ${b.to}`,
          category: "Conversion",
          postings: [
            {
              currency: b.from,
              account: "available" as const,
              amount: -q.amount,
            },
            {
              currency: b.from,
              account: "external" as const,
              amount: q.amount,
            },
            {
              currency: b.to,
              account: "available" as const,
              amount: q.received,
            },
            {
              currency: b.to,
              account: "external" as const,
              amount: -q.received,
            },
          ],
        };
        append(data, e);
        return e;
      });
    }
    if (path === "/rates/refresh") {
      const s = sampleSnapshot(6 + snapshots.length);
      s.fetchedAt = now();
      snapshots.push(s);
      snapshots = snapshots.slice(-30);
      evaluateFixtureAlerts(s);
      return snapshots;
    }
    if (path === "/alerts" && method === "POST") {
      const b = z
        .object({
          requestId,
          from: currency,
          to: currency,
          direction: z.enum(["increase", "decrease"]),
          mode: z.enum(["percent", "absolute", "target"]),
          threshold: z.number().positive().max(1000),
          watched: amount.optional(),
        })
        .parse(body);
      if (b.from === b.to) throw new Error("Select different currencies.");
      return idempotent(data, b.requestId, JSON.stringify(b), () => {
        if (data.alerts.length >= 25) throw new Error("Maximum 25 alerts.");
        const a = {
          ...b,
          id: crypto.randomUUID(),
          enabled: true,
          reference: snapshots.length
            ? snapshotRate(snapshots.at(-1)!, b.from, b.to)
            : (() => {
                throw new Error(
                  "No rate observation is available for this alert.",
                );
              })(),
          watched: b.watched ? minor(b.watched, b.from) : undefined,
        };
        data.alerts.push(a);
        return a;
      });
    }
    if (path.startsWith("/alerts/") && method === "PATCH") {
      const b = z.object({ enabled: z.boolean() }).parse(body);
      const a = data.alerts.find((a) => a.id === path.split("/")[2]);
      if (!a) throw new Error("Alert not found.");
      a.enabled = b.enabled;
      return a;
    }
    if (path === "/notifications/read") {
      data.notices.forEach((n) => (n.read = true));
      return { ok: true };
    }
    if (path === "/rates/insight") return fixtureInsight(body);
    if (path === "/reports") {
      const b = z
        .object({
          frequency: z.enum(["weekly", "monthly"]),
          date: z.iso.date().optional(),
          timezone: z.string().default("UTC"),
        })
        .parse(body);
      const result = buildReport(
        data,
        b.frequency,
        Date.now(),
        b.date,
        b.timezone,
      );
      result.report.observations.unshift(
        "Sample savings insight using local calculations. No live AI request was made.",
      );
      data.reports.unshift(result.report);
      data.reports = data.reports.slice(0, 24);
      data.recommendations.forEach((r) => {
        if (r.status === "pending") r.status = "dismissed";
      });
      data.recommendations.unshift(...result.recommendations);
      data.recommendations = data.recommendations.slice(0, 72);
      return result.report;
    }
    if (path.startsWith("/recommendations/")) {
      const b = z
        .object({ decision: z.enum(["accepted", "dismissed"]) })
        .parse(body);
      const r = data.recommendations.find((r) => r.id === path.split("/")[2]);
      if (!r) throw new Error("Recommendation not found.");
      if (r.status !== "pending") return r;
      if (b.decision === "accepted") {
        if (
          data.preferences.increments[r.currency] !== r.current ||
          data.preferences.caps[r.currency] !== r.cap ||
          data.preferences.savings !== "enabled" ||
          data.ledger.at(-1)?.id !== r.ledgerRevision
        )
          throw new Error(
            "Your savings settings or wallet activity changed. Generate a new report.",
          );
        data.preferences.increments[r.currency] = r.suggested;
      }
      r.status = b.decision;
      return r;
    }
    throw new Error("This operation is unavailable in Developer Fixture Mode.");
  }
  return (path: string, body?: unknown, method = "POST") => {
    const before = JSON.stringify({ data, snapshots });
    try {
      const result = handle(path, body, method);
      persist();
      return structuredClone(result);
    } catch (error) {
      ({ data, snapshots } = JSON.parse(before));
      throw error instanceof z.ZodError
        ? new Error("Check the fixture form values and try again.")
        : error;
    }
  };
}
