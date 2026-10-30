import { cacheScope } from "../requestCache";
import { publicMarketRead } from "../publicMarket";
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
  initialUser,
  purchase,
  refund,
} from "../../shared/ledger";
import { currencies, convert, minor } from "../../shared/money";
import { buildReport } from "../../shared/reports";
import { currencyFacts } from "../../shared/currency-insights";
import type {
  MarketFeed,
  MarketStatus,
  Snapshot,
  State,
  UserData,
} from "../../shared/types";
import { DEMO_STORAGE_KEY, demoEnabled } from "../demoSession";
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
  const data = initialUser(true);
  data.preferences.name = "Alex (Demo)";
  data.preferences.savings = "enabled";
  data.profile = {
    fullName: "Alex (Demo)",
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
    title: "Welcome to Developer Demo Mode",
    body: "Wallet balances, transactions and savings are simulated. Choose real Forex or sample rates in Currency Rates. Your wallet activity stays in this tab.",
    read: false,
  });
  const result = buildReport(data, "monthly");
  result.report.observations.unshift(
    "Sample savings insight using local calculations. No live AI request was made.",
  );
  data.reports.push(result.report);
  data.recommendations.push(...result.recommendations);
  return data;
}
// Only the fixed read-only public market client is allowed. Financial operations remain local.
export function createDemoService() {
  if (!demoEnabled()) throw new Error("Developer Demo Mode is disabled.");
  let data: UserData;
  let snapshots: Snapshot[] = [];
  let marketMode: "live" | "sample" = "live",
    marketRevision = 0;
  let staleMs = 600000;
  let marketStatus: MarketStatus = {
    provider: "Twelve Data",
    configured: false,
    transport: "polling",
    pollMs: 300000,
    staleMs,
    connection: "waiting",
  };
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(DEMO_STORAGE_KEY) || "null",
    );
    if (!saved?.data?.profile || !Array.isArray(saved.snapshots))
      throw new Error();
    data = saved.data;
    marketMode = saved.marketMode === "sample" ? "sample" : "live";
    snapshots = marketMode === "sample" ? saved.snapshots : [];
  } catch {
    data = seed();
    snapshots = [];
  }
  const persist = () =>
    sessionStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({
        data,
        snapshots: marketMode === "sample" ? snapshots : [],
        marketMode,
      }),
    );
  persist();
  function demoInsight(body: unknown, points = snapshots) {
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
    authMode: "demo",
    demoMarketMode: marketMode,
    marketStatus: marketMode === "live" ? marketStatus : undefined,
    rateStaleMs: marketMode === "live" ? staleMs : 36 * 3600000,
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
  function evaluateDemoAlerts(s: Snapshot) {
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
          title: `Demo wallet ${a.from}/${a.to} alert`,
          body:
            marketMode === "live"
              ? "Recorded real Forex crossed your local demo threshold. Wallet funds remain simulated."
              : "Sample rate crossed your configured threshold. No live market data was requested.",
          read: false,
        });
      a.reference = rate;
      a.lastTriggered = now();
    }
  }
  function handle(path: string, body: unknown, method: string) {
    if (path === "/state" && body === undefined) return state();
    if (path === "/demo/market-mode") {
      const next = z.object({ mode: z.enum(["live", "sample"]) }).parse(body);
      marketRevision++;
      marketMode = next.mode;
      marketStatus = {
        ...marketStatus,
        connection: "waiting",
        error: undefined,
      };
      snapshots = marketMode === "sample" ? [0, 3, 6].map(sampleSnapshot) : [];
      return state();
    }
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
      throw new Error("PayPal operations are disabled in Developer Demo Mode.");
    if (path === "/purchases" && method === "POST") {
      const b = z
        .object({
          requestId,
          currency,
          amount,
          description: z.string().trim().min(1).max(80),
          category: z.enum([
            "Food & drink",
            "Shopping",
            "Transport",
            "Education",
            "Bills",
            "Other",
          ]),
        })
        .parse(body);
      return idempotent(data, b.requestId, JSON.stringify(b), () =>
        purchase(
          data,
          b.currency,
          minor(b.amount, b.currency),
          b.description,
          b.category,
        ),
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
            ILS: id.optional(),
            USD: id.optional(),
            JOD: id.optional(),
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
    if (path === "/goals" && method === "POST") {
      const b = z
        .object({
          requestId,
          currency,
          amount,
          name: z.string().trim().min(1).max(60),
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
        data.preferences.goalIds[g.currency] = g.id;
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
      evaluateDemoAlerts(s);
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
    if (path === "/rates/insight") return demoInsight(body);
    if (path === "/reports") {
      const b = z
        .object({ frequency: z.enum(["weekly", "monthly"]) })
        .parse(body);
      const result = buildReport(data, b.frequency);
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
    throw new Error("This operation is unavailable in Developer Demo Mode.");
  }
  return (path: string, body?: unknown, method = "POST") => {
    if (!demoEnabled()) throw new Error("Developer Demo Mode is disabled.");
    if (
      marketMode === "live" &&
      (path === "/rates/live" ||
        path === "/rates/refresh" ||
        path.startsWith("/rates/history?"))
    ) {
      const revision = marketRevision,
        scope = cacheScope();
      if (path.startsWith("/rates/history?")) {
        const period = new URLSearchParams(path.split("?")[1]).get(
          "period",
        ) as HistoryPeriod;
        if (!historyPeriods[period])
          throw new Error("Choose a supported history period.");
        return publicMarketRead("history", period);
      }
      return publicMarketRead("live")
        .then((feed: MarketFeed) => {
          if (revision !== marketRevision || scope !== cacheScope())
            return { snapshots, status: marketStatus };
          snapshots = feed.snapshots;
          staleMs = feed.status.staleMs;
          marketStatus = feed.status;
          const last = snapshots.at(-1);
          if (last && data.alerts.length) {
            evaluateDemoAlerts(last);
            persist();
          }
          return structuredClone(
            path === "/rates/refresh"
              ? snapshots
              : { snapshots, status: marketStatus, notices: data.notices },
          );
        })
        .catch((error) => {
          if (revision === marketRevision && scope === cacheScope())
            marketStatus = {
              ...marketStatus,
              connection: "unavailable",
              error:
                "Real Forex is unavailable. No sample rates have been substituted.",
            };
          throw error;
        });
    }
    if (
      marketMode === "live" &&
      path === "/rates/insight" &&
      (body as { period?: string })?.period &&
      (body as { period?: string }).period !== "available"
    ) {
      const revision = marketRevision,
        scope = cacheScope();
      return publicMarketRead("history", "90d").then((history) => {
        if (revision !== marketRevision || scope !== cacheScope())
          throw new Error(
            "The selected rate source changed. Please try again.",
          );
        const points = [
          ...new Map(
            [...history.snapshots, ...snapshots].map((s) => [s.id, s]),
          ).values(),
        ].sort(
          (a, b) =>
            Date.parse(a.publishedAt ?? a.fetchedAt) -
            Date.parse(b.publishedAt ?? b.fetchedAt),
        );
        return demoInsight(body, points);
      });
    }
    const before = JSON.stringify({ data, snapshots });
    try {
      const result = handle(path, body, method);
      persist();
      return structuredClone(result);
    } catch (error) {
      ({ data, snapshots } = JSON.parse(before));
      throw error instanceof z.ZodError
        ? new Error("Check the demo form values and try again.")
        : error;
    }
  };
}
