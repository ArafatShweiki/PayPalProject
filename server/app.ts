import { publicMarketRouter } from "./public-market";
import { forexEnabled, forexStatus } from "./forex";
import { forexHistory } from "./forex-store";
import {
  historyPeriods,
  snapshotRate,
  pairTime,
  isQuoteStale,
  rateMethod,
} from "../shared/market";
import { DatabaseError } from "./database-errors";
import { databaseState } from "./database-state";
import "./env";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ServiceError, limitMiddleware, fingerprint } from "./reliability";
import { randomUUID, createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { currencies, minor, convert } from "../shared/money";
import type { Entry, Preferences, UserData } from "../shared/types";
import { append, balances, idempotent, purchase, refund } from "./ledger";
import { firebaseEnabled, userRead, userUpdate, snapshots } from "./store";
import { refreshRates, stale, rateStaleMs } from "./rates";
import { buildReport, explain } from "./reports";
import { paypal, paypalEnabled, verifyCapture } from "./paypal";
import { currencyInsight } from "./currency-insights";
import { auth0Enabled, auth0Config, verifyWalletIdentity } from "./auth0";
import { onboardingRouter } from "./onboarding";
import {
  acceptSavingsRule,
  readIdempotentTransaction,
  readSavingsRules,
  supabaseEnabled,
  initializeProfile,
  readProfile,
  applyLedgerTransaction,
  readPurchasable,
  readPurchaseLedger,
  updateProfilePreferences,
} from "./supabase";
import { roundUp } from "../shared/money";
export const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          "https://*.googleapis.com",
          "https://*.firebaseapp.com",
          "https://securetoken.googleapis.com",
          ...(supabaseEnabled()
            ? [new URL(process.env.SUPABASE_URL!).origin]
            : []),
          ...(auth0Config ? [`https://${auth0Config.domain}`] : []),
        ],
        frameSrc: [
          "https://*.firebaseapp.com",
          ...(auth0Config ? [`https://${auth0Config.domain}`] : []),
        ],
        workerSrc: ["'self'", "blob:"],
        imgSrc: ["'self'", "data:"],
      },
    },
  }),
);
app.use("/api", (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader("X-Request-ID", res.locals.requestId);
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
app.use("/api", limitMiddleware("entry", "RATE_LIMIT_ENTRY", 120));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
const currency = z.enum(currencies);
const requestId = z.string().uuid();
const amount = z.string().max(20);
const id = z.string().min(1).max(128);
app.get("/api/config", (_req, res) =>
  res.json({
    marketProvider: forexEnabled() ? "Twelve Data" : "PMA",
    auth0: auth0Config,
    supabase: supabaseEnabled()
      ? {
          url: process.env.SUPABASE_URL,
          publishableKey:
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            process.env.SUPABASE_ANON_KEY,
        }
      : null,
    firebase: !auth0Enabled && firebaseEnabled,
    firebaseConfig: firebaseEnabled
      ? {
          apiKey: process.env.FIREBASE_WEB_API_KEY,
          authDomain: process.env.FIREBASE_AUTH_DOMAIN,
          projectId: process.env.FIREBASE_PROJECT_ID,
        }
      : null,
  }),
);
app.use("/api/market-data", publicMarketRouter);
app.get("/api/cron", async (req, res) => {
  if (
    !process.env.CRON_SECRET ||
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await refreshRates();
  res.json({ ok: true });
});
app.use("/api", async (req, res, next) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
      if (origin && origin !== allowed)
        throw new Error("Request origin not allowed.");
      if (req.headers["x-walletwise"] !== "1")
        throw new Error("Missing request header.");
    }
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (auth0Enabled) {
      if (!token) {
        res.status(401).json({ error: "Please sign in to continue." });
        return;
      }
      const identity = await verifyWalletIdentity(token);
      res.locals.uid = identity.uid;
      res.locals.sub = identity.sub;
      res.locals.idToken = token;
      res.locals.authMode = "auth0";
    } else if (token && firebaseEnabled) {
      const verified = await getAuth().verifyIdToken(token, true);
      res.locals.uid = verified.uid;
      res.locals.authMode = "firebase";
    } else {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    next();
  } catch {
    res
      .status(401)
      .json({ error: "Session could not be verified. Please sign in again." });
  }
});
app.use("/api", (req, res, next) => {
  const path = req.path;
  if (req.method === "GET" || req.method === "HEAD")
    return limitMiddleware(
      "read",
      "RATE_LIMIT_READ",
      120,
      true,
    )(req, res, next);
  if (path === "/reports" || path === "/rates/insight")
    return limitMiddleware("ai", "RATE_LIMIT_AI", 5, true)(req, res, next);
  if (path === "/rates/refresh")
    return limitMiddleware(
      "refresh",
      "RATE_LIMIT_REFRESH",
      3,
      true,
    )(req, res, next);
  if (path.startsWith("/paypal/"))
    return limitMiddleware(
      "payment",
      "RATE_LIMIT_PAYMENT",
      5,
      true,
    )(req, res, next);
  if (
    path === "/preferences" ||
    path.startsWith("/onboarding") ||
    path.startsWith("/recommendations/")
  )
    return limitMiddleware(
      "profile",
      "RATE_LIMIT_PROFILE",
      20,
      true,
    )(req, res, next);
  return limitMiddleware(
    "financial",
    "RATE_LIMIT_FINANCIAL",
    30,
    true,
  )(req, res, next);
});
app.use("/api", async (_req, res, next) => {
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    try {
      await initializeProfile(res.locals.sub);
      await userUpdate(res.locals.uid, (data) => {
        data.auth0Sub = res.locals.sub;
      });
    } catch {
      res
        .status(503)
        .json({ error: "Wallet database is unavailable. Please try again." });
      return;
    }
  }
  next();
});
app.use("/api/onboarding", onboardingRouter);
app.use("/api", async (req, res, next) => {
  if (
    res.locals.authMode === "auth0" &&
    supabaseEnabled() &&
    req.path !== "/logout"
  ) {
    const profile = await readProfile(res.locals.sub);
    if (!profile?.onboarding_completed_at) {
      res.status(403).json({
        code: "ONBOARDING_REQUIRED",
        error: "Complete your profile to open your wallet.",
      });
      return;
    }
  } else if (res.locals.authMode === "auth0" && req.path !== "/logout") {
    const data = await userRead(res.locals.uid);
    if (!data.profile?.completedAt) {
      res.status(403).json({
        code: "ONBOARDING_REQUIRED",
        error: "Complete your profile to open your wallet.",
      });
      return;
    }
  }
  next();
});
app.get("/api/state", async (_req, res) => {
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const { data, walletBalances, savingsBalances } = await databaseState(
      res.locals.sub,
      res.locals.uid,
    );
    res.json({
      ...data,
      operations: undefined,
      balances: walletBalances,
      savingsBalances,
      snapshots: await snapshots(),
      rateStaleMs: rateStaleMs(),
      authMode: "auth0",
      capabilities: {
        firebase: firebaseEnabled,
        paypal: paypalEnabled(),
        gemini: !!process.env.GEMINI_API_KEY,
      },
    });
    return;
  }
  const data = await userRead(res.locals.uid);
  const rates = await snapshots();
  res.json({
    ...data,
    operations: undefined,
    balances: balances(data),
    savingsBalances: balances(data, "savings"),
    snapshots: rates,
    rateStaleMs: rateStaleMs(),
    authMode: res.locals.authMode,
    capabilities: {
      firebase: firebaseEnabled,
      paypal: paypalEnabled(),
      gemini: !!process.env.GEMINI_API_KEY,
    },
  });
});
app.post("/api/logout", (_req, res) => {
  res.clearCookie("ww_session");
  res.json({ ok: true });
});
const mutate = (
  uid: string,
  key: string,
  body: unknown,
  fn: (data: UserData) => unknown,
) =>
  userUpdate(uid, (data) =>
    idempotent(data, key, JSON.stringify(body), () => fn(data)),
  );
app.post("/api/purchases", async (req, res) => {
  const body = z
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
    .parse(req.body);
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const profile = await readProfile(res.locals.sub);
    const rules = await readSavingsRules(res.locals.sub);
    const rule = rules.find((r) => r.currency === body.currency);
    const value = minor(body.amount, body.currency);
    const saved = profile?.savings_enabled
      ? roundUp(value, Number(rule!.increment_minor), Number(rule!.cap_minor))
      : 0;
    const result = await applyLedgerTransaction({
      sub: res.locals.sub,
      requestId: body.requestId,
      fingerprint: JSON.stringify(body),
      kind: "purchase",
      metadata: {
        goalId:
          profile?.wallet_preferences.goalIds?.[body.currency] ||
          (await userRead(res.locals.uid)).preferences.goalIds[body.currency],
      },
      description: body.description,
      category: body.category,
      entries: [
        {
          currency: body.currency,
          account: "available",
          amount_minor: -value - saved,
        },
        { currency: body.currency, account: "external", amount_minor: value },
        ...(saved
          ? [
              {
                currency: body.currency,
                account: "savings" as const,
                amount_minor: saved,
              },
            ]
          : []),
      ],
    });
    res.json(result);
    return;
  }
  res.json(
    await mutate(res.locals.uid, body.requestId, body, (data) =>
      purchase(
        data,
        body.currency,
        minor(body.amount, body.currency),
        body.description,
        body.category,
      ),
    ),
  );
});
app.post("/api/refunds", async (req, res) => {
  const body = z.object({ requestId, id }).parse(req.body);
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const prior = await readPurchasable(res.locals.sub, body.id);
    if (!prior) throw new Error("Purchase not found.");
    const postings = await readPurchaseLedger(res.locals.sub, body.id);
    const result = await applyLedgerTransaction({
      sub: res.locals.sub,
      requestId: body.requestId,
      fingerprint: JSON.stringify(body),
      kind: "refund",
      description: `Refund: ${prior.description}`,
      category: prior.category,
      entries: postings.map((entry) => ({
        currency: entry.currency,
        account: entry.account,
        amount_minor: -Number(entry.amount_minor),
      })),
      metadata: {
        originalId: body.id,
        ...(prior.metadata?.goalId ? { goalId: prior.metadata.goalId } : {}),
      },
    });
    res.json(result);
    return;
  }
  res.json(
    await mutate(res.locals.uid, body.requestId, body, (data) =>
      refund(data, body.id),
    ),
  );
});
const numbers = z.object({
  ILS: z.number().int().min(1).max(100000),
  USD: z.number().int().min(1).max(100000),
  JOD: z.number().int().min(1).max(1000000),
});
const preferences = z.object({
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
});
app.put("/api/preferences", async (req, res) => {
  const body = preferences.partial().parse(req.body);
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const prior = await readProfile(res.locals.sub);
    if (!prior?.onboarding_completed_at)
      throw new Error("Complete onboarding first.");
    if (body.savings === "unseen")
      throw new Error("Savings setup has already been completed.");
    if (body.goalIds) {
      const data = await userRead(res.locals.uid);
      for (const c of currencies)
        if (
          body.goalIds[c] &&
          !data.goals.some((g) => g.id === body.goalIds![c] && g.currency === c)
        )
          throw new Error("Select a goal in the matching currency.");
    }
    const profile = await updateProfilePreferences(res.locals.sub, body);
    res.json({
      ...(await userRead(res.locals.uid)).preferences,
      ...profile.wallet_preferences,
      name: profile.full_name || "",
      preferred: profile.preferred_currency,
      savings: profile.savings_enabled ? "enabled" : "disabled",
      notifications: profile.currency_notifications,
    });
    return;
  }
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      const next: Preferences = { ...data.preferences, ...body };
      for (const c of currencies)
        if (
          next.goalIds[c] &&
          !data.goals.some((g) => g.id === next.goalIds[c] && g.currency === c)
        )
          throw new Error("Select a goal in the matching currency.");
      if (res.locals.authMode === "auth0" && body.savings === "unseen")
        throw new Error("Savings setup has already been completed.");
      data.preferences = next;
      if (data.profile) data.profile.fullName = next.name;
      return next;
    }),
  );
});
app.post("/api/goals", async (req, res) => {
  const body = z
    .object({
      requestId,
      name: z.string().trim().min(1).max(60),
      currency,
      amount,
      targetDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .parse(req.body);
  const goal = await mutate(res.locals.uid, body.requestId, body, (data) => {
    if (data.goals.length >= 25) throw new Error("Maximum 25 goals.");
    const goal = {
      id: randomUUID(),
      name: body.name,
      currency: body.currency,
      target: minor(body.amount, body.currency),
      createdAt: new Date().toISOString(),
      ...(body.targetDate ? { targetDate: body.targetDate } : {}),
    };
    data.goals.push(goal);
    data.preferences.goalIds[goal.currency] = goal.id;
    return goal;
  });
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const profile = await readProfile(res.locals.sub);
    const selected = (await userRead(res.locals.uid)).preferences.goalIds;
    await updateProfilePreferences(res.locals.sub, {
      goalIds: {
        ...selected,
        ...profile?.wallet_preferences.goalIds,
        [body.currency]: (goal as { id: string }).id,
      },
    });
  }
  res.json(goal);
});
app.get("/api/rates/live", async (_req, res) => {
  if (!forexEnabled()) {
    res.json({
      snapshots: await snapshots(),
      notices: (await userRead(res.locals.uid)).notices,
      status: {
        provider: "PMA",
        configured: true,
        transport: "polling",
        pollMs: 21600000,
        staleMs: rateStaleMs(),
        connection: "connected",
      },
    });
    return;
  }
  try {
    await refreshRates();
  } catch {
    /* Shared last-good data remains visible with explicit status. */
  }
  const status = await forexStatus();
  if (!status.configured) {
    status.connection = "unavailable";
    status.error =
      "Configure Twelve Data on the server to receive Forex prices.";
  }
  res.json({
    snapshots: await snapshots(),
    status,
    notices: (await userRead(res.locals.uid)).notices,
  });
});
app.get("/api/rates/history", async (req, res) => {
  const period = z
    .enum(["1h", "24h", "7d", "30d", "90d"])
    .parse(req.query.period);
  const points = forexEnabled()
    ? await forexHistory(period)
    : (await snapshots()).filter(
        (s) =>
          Date.parse(s.publishedAt ?? s.fetchedAt) >=
          Date.now() - historyPeriods[period].ms,
      );
  res.json({
    snapshots: points,
    period,
    source: forexEnabled()
      ? "Twelve Data stored observations"
      : "PMA stored observations",
  });
});
app.post("/api/rates/refresh", async (_req, res) => {
  try {
    res.json(await refreshRates());
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "The configured rate provider is unavailable. Previously retrieved observations remain visible.",
    );
  }
});
const conversionBody = z.object({ from: currency, to: currency, amount });
async function quote(body: z.infer<typeof conversionBody>) {
  if (body.from === body.to)
    throw new Error("Select two different currencies.");
  if (forexEnabled()) await refreshRates();
  const s = (await snapshots()).at(-1);
  if (!s || isQuoteStale(s, body.from, body.to, rateStaleMs()))
    throw new Error(
      "A recent rate observation is required. Refresh rates first.",
    );
  const value = minor(body.amount, body.from);
  const rate = snapshotRate(s, body.from, body.to);
  const received = convert(value, body.from, body.to, rate);
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
    observedAt: pairTime(s, body.from, body.to),
    method: rateMethod(s, body.from, body.to),
    simulatedFee: 0,
    simulatedSpread: 0,
    expiresAt: new Date(
      Math.min(
        Date.now() + (forexEnabled() ? 60000 : 5 * 60000),
        Date.parse(pairTime(s, body.from, body.to)) + rateStaleMs(),
      ),
    ).toISOString(),
  };
}
app.post("/api/conversions/preview", async (req, res) =>
  res.json(await quote(conversionBody.parse(req.body))),
);
app.post("/api/conversions", async (req, res) => {
  const body = conversionBody
    .extend({
      requestId,
      snapshotId: id,
      rate: z.number().int().positive(),
      expiresAt: z.iso.datetime(),
    })
    .parse(req.body);
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const replay = await readIdempotentTransaction(
      res.locals.sub,
      body.requestId,
      JSON.stringify(body),
    );
    if (replay) {
      res.json(replay);
      return;
    }
  }
  const existing = await userRead(res.locals.uid);
  if (existing.operations[body.requestId]) {
    res.json(await mutate(res.locals.uid, body.requestId, body, () => null));
    return;
  }
  if (
    Date.parse(body.expiresAt) < Date.now() ||
    Date.parse(body.expiresAt) >
      Date.now() + (forexEnabled() ? 60000 : 5 * 60000) + 1000
  )
    throw new Error("Preview expired. Please request a new quote.");
  const q = await quote(body);
  if (q.rate !== body.rate)
    throw new Error("Rate changed. Preview the conversion again.");
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const result = await applyLedgerTransaction({
      sub: res.locals.sub,
      requestId: body.requestId,
      fingerprint: JSON.stringify(body),
      kind: "conversion",
      description: `${body.from} → ${body.to}`,
      category: "Conversion",
      entries: [
        { currency: body.from, account: "available", amount_minor: -q.amount },
        { currency: body.from, account: "external", amount_minor: q.amount },
        { currency: body.to, account: "available", amount_minor: q.received },
        { currency: body.to, account: "external", amount_minor: -q.received },
      ],
      metadata: {
        to: body.to,
        rate: q.rate,
        snapshotId: q.snapshotId,
        quoteSource: q.source,
        observedAt: q.observedAt,
        method: q.method,
        simulatedFee: 0,
        simulatedSpread: 0,
        received: q.received,
      },
    });
    res.json(result);
    return;
  }
  res.json(
    await mutate(res.locals.uid, body.requestId, body, (data) => {
      const e: Entry = {
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: "conversion",
        currency: body.from,
        amount: q.amount,
        saved: 0,
        description: `${body.from} → ${body.to}`,
        category: "Conversion",
        to: body.to,
        received: q.received,
        rate: q.rate,
        snapshotId: q.snapshotId,
        quoteSource: q.source,
        observedAt: q.observedAt,
        method: q.method,
        simulatedFee: 0,
        simulatedSpread: 0,
        postings: [
          { currency: body.from, account: "available", amount: -q.amount },
          { currency: body.from, account: "external", amount: q.amount },
          { currency: body.to, account: "available", amount: q.received },
          { currency: body.to, account: "external", amount: -q.received },
        ],
      };
      append(data, e);
      return e;
    }),
  );
});
app.post("/api/alerts", async (req, res) => {
  const body = z
    .object({
      requestId,
      from: currency,
      to: currency,
      direction: z.enum(["increase", "decrease"]),
      mode: z.enum(["percent", "absolute", "target"]),
      threshold: z.number().positive().max(1000),
      watched: amount.optional(),
    })
    .parse(req.body);
  if (body.from === body.to) throw new Error("Select different currencies.");
  const s = (await snapshots()).at(-1);
  if (!s || stale(s))
    throw new Error("Refresh rates before creating an alert.");
  res.json(
    await mutate(res.locals.uid, body.requestId, body, (data) => {
      if (data.alerts.length >= 25) throw new Error("Maximum 25 alerts.");
      const alert = {
        id: randomUUID(),
        from: body.from,
        to: body.to,
        direction: body.direction,
        mode: body.mode,
        threshold: body.threshold,
        enabled: true,
        reference: snapshotRate(s, body.from, body.to),
        ...(body.watched ? { watched: minor(body.watched, body.from) } : {}),
      };
      data.alerts.push(alert);
      return alert;
    }),
  );
});
app.patch("/api/alerts/:id", async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      const a = data.alerts.find((a) => a.id === req.params.id);
      if (!a) throw new Error("Alert not found.");
      a.enabled = enabled;
      return a;
    }),
  );
});
app.post("/api/notifications/read", async (_req, res) => {
  await userUpdate(res.locals.uid, (data) => {
    data.notices.forEach((n) => (n.read = true));
  });
  res.json({ ok: true });
});
app.post("/api/rates/insight", async (req, res) => {
  const body = z
    .object({
      from: currency,
      to: currency,
      amount: amount.optional(),
      period: z.enum(["available", "24h", "7d", "30d"]).optional(),
    })
    .parse(req.body);
  const data =
    res.locals.authMode === "auth0" && supabaseEnabled()
      ? (await databaseState(res.locals.sub, res.locals.uid)).data
      : await userRead(res.locals.uid);
  const selected = body.amount
    ? minor(body.amount, body.from)
    : balances(data)[body.from];
  res.json(
    await currencyInsight(
      body.period && body.period !== "available" && forexEnabled()
        ? [...(await forexHistory("90d")), ...(await snapshots())].sort(
            (a, b) =>
              Date.parse(pairTime(a, body.from, body.to)) -
              Date.parse(pairTime(b, body.from, body.to)),
          )
        : await snapshots(),
      body.from,
      body.to,
      selected,
      res.locals.uid,
      body.period,
    ),
  );
});
app.post("/api/reports", async (req, res) => {
  const { frequency } = z
    .object({ frequency: z.enum(["weekly", "monthly"]) })
    .parse(req.body);
  const data =
    res.locals.authMode === "auth0" && supabaseEnabled()
      ? (await databaseState(res.locals.sub, res.locals.uid)).data
      : await userRead(res.locals.uid);
  const { report, recommendations } = buildReport(data, frequency);
  const result = await explain(
    report,
    await snapshots(),
    res.locals.uid,
    fingerprint({
      ledger: data.ledger,
      goals: data.goals,
      preferences: data.preferences,
    }),
  );
  await userUpdate(res.locals.uid, (data) => {
    data.reports.unshift(result);
    data.reports = data.reports.slice(0, 24);
    data.recommendations.forEach((r) => {
      if (r.status === "pending") r.status = "dismissed";
    });
    data.recommendations.unshift(...recommendations);
    data.recommendations = data.recommendations.slice(0, 72);
  });
  res.json(result);
});
app.post("/api/recommendations/:id", async (req, res) => {
  const { decision } = z
    .object({ decision: z.enum(["accepted", "dismissed"]) })
    .parse(req.body);
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const data = await userRead(res.locals.uid);
    const rule = data.recommendations.find((r) => r.id === req.params.id);
    if (!rule) throw new Error("Recommendation not found.");
    if (rule.status !== "pending") {
      res.json(rule);
      return;
    }
    if (decision === "accepted") await acceptSavingsRule(res.locals.sub, rule);
    const saved = await userUpdate(res.locals.uid, (current) => {
      const persisted = current.recommendations.find((r) => r.id === rule.id);
      if (!persisted) throw new Error("Recommendation not found.");
      persisted.status = decision;
      return persisted;
    });
    res.json(saved);
    return;
  }
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      const r = data.recommendations.find((r) => r.id === req.params.id);
      if (!r) throw new Error("Recommendation not found.");
      if (r.status !== "pending") return r;
      if (decision === "accepted") {
        if (
          data.preferences.increments[r.currency] !== r.current ||
          data.preferences.caps[r.currency] !== r.cap ||
          data.preferences.savings !== "enabled" ||
          (data.ledger.at(-1)?.id ?? "") !== r.ledgerRevision
        )
          throw new Error(
            "Your savings settings or wallet activity changed. Generate a new report.",
          );
        data.preferences.increments[r.currency] = r.suggested;
      }
      r.status = decision;
      return r;
    }),
  );
});
app.post("/api/paypal/orders", async (req, res) => {
  const { requestId: key } = z.object({ requestId }).parse(req.body);
  const data = await userRead(res.locals.uid);
  const prior = data.sandbox.find((o) => o.requestId === key);
  if (prior) {
    res.json(prior);
    return;
  }
  const origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
  const response = await paypal(
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "1.00" },
          description: "Dream Piggy Bank test payment",
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: `${origin}/?paypal=approved`,
            cancel_url: `${origin}/?paypal=canceled`,
            user_action: "PAY_NOW",
          },
        },
      },
    },
    createHash("sha256")
      .update(res.locals.uid + key)
      .digest("hex")
      .slice(0, 36),
  );
  const approvalUrl = response.links?.find(
    (l: { rel: string }) => l.rel === "payer-action" || l.rel === "approve",
  )?.href;
  if (
    typeof response.id !== "string" ||
    !approvalUrl ||
    new URL(approvalUrl).hostname !== "www.sandbox.paypal.com"
  )
    throw new Error("PayPal did not return a valid Sandbox approval link.");
  const order = {
    id: response.id,
    requestId: key,
    status: "CREATED",
    approvalUrl,
    at: new Date().toISOString(),
  };
  await userUpdate(res.locals.uid, (data) => {
    if (!data.sandbox.some((o) => o.id === order.id)) data.sandbox.push(order);
  });
  res.json(order);
});
app.post("/api/paypal/:id/capture", async (req, res) => {
  const orderId = z
    .string()
    .regex(/^[A-Z0-9]+$/)
    .parse(req.params.id);
  const data = await userRead(res.locals.uid);
  const order = data.sandbox.find((o) => o.id === orderId);
  if (!order) throw new Error("Sandbox order not found for this account.");
  if (order.status === "COMPLETED" || order.status === "CANCELED") {
    res.json(order);
    return;
  }
  // Reconcile first: a previous capture may have succeeded before its response was lost.
  const current = await paypal(
    `/v2/checkout/orders/${orderId}`,
    undefined,
    `lookup-${orderId}`,
    "GET",
  );
  const hasCapture = current.purchase_units?.some(
    (p: { payments?: { captures?: unknown[] } }) =>
      p.payments?.captures?.length,
  );
  const response = hasCapture
    ? current
    : await paypal(
        `/v2/checkout/orders/${orderId}/capture`,
        {},
        `capture-${orderId}`,
      );
  const verified = verifyCapture(response, orderId);
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      const o = data.sandbox.find((o) => o.id === orderId)!;
      Object.assign(o, verified);
      return o;
    }),
  );
});
app.post("/api/paypal/:id/cancel", async (req, res) => {
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      const order = data.sandbox.find((o) => o.id === req.params.id);
      if (!order) throw new Error("Order not found.");
      if (order.status === "CREATED") order.status = "CANCELED";
      return order;
    }),
  );
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      err &&
      typeof err === "object" &&
      "type" in err &&
      err.type === "entity.too.large"
    ) {
      res.status(413).json({
        error: "This request is too large.",
        requestId: res.locals.requestId,
      });
      return;
    }
    if (err instanceof ServiceError || err instanceof DatabaseError) {
      if (err instanceof ServiceError && err.retryAfter)
        res.setHeader("Retry-After", err.retryAfter);
      res
        .status(err.status)
        .json({ error: err.message, requestId: res.locals.requestId });
      return;
    }
    if (err instanceof SyntaxError || err instanceof z.ZodError) {
      res.status(400).json({
        error: "Please check the form values and try again.",
        requestId: res.locals.requestId,
      });
      return;
    }
    const message = err instanceof Error ? err.message : "";
    const safe =
      /^(Insufficient |Idempotency key reused|This request identifier was already used|Purchase not found|Sandbox order not found|Order not found|Recommendation not found|Choose a positive amount|Refresh rates before|Select |Maximum |Amount |Enter a positive|Preview expired|Rate changed|A recent rate observation|Your savings settings|Savings setup|Complete onboarding|PayPal Sandbox is not configured|PayPal Sandbox authentication unavailable|PayPal Sandbox request could not be completed)/.test(
        message,
      );
    const unavailable =
      /PayPal Sandbox.*(unavailable|could not be completed)|Storage unavailable/.test(
        message,
      );
    if (!safe)
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId: res.locals.requestId,
        }),
      );
    res.status(unavailable ? 503 : safe ? 400 : 500).json({
      error: safe
        ? message
        : "Request could not be completed. Please try again.",
      requestId: res.locals.requestId,
    });
  },
);
