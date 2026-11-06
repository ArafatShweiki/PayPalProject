import {
  circlesRouter,
  invitationPublicRouter,
  savingsRpc,
} from "./savings-circles";
import { databaseError } from "./database-errors";
import { diagnostics, timed } from "./diagnostics";
import { bootstrap } from "./bootstrap";
import { progressiveRouter } from "./progressive";
import { fundingRouter, fundingEnabled } from "./funding";
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
import { backendStorage, sqlStorage } from "./backend-storage";
import {
  applicationOrigin,
  validateDeploymentConfiguration,
} from "./configuration";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ServiceError, limitMiddleware } from "./reliability";
import { randomUUID } from "node:crypto";

import { z } from "zod";
import { currencies, minor, convert } from "../shared/money";
import type { Entry, Preferences, UserData } from "../shared/types";
import { append, balances, idempotent } from "./ledger";
import { userRead, userUpdate, snapshots, registerUserIdentity } from "./store";
import { refreshRates, stale, rateStaleMs } from "./rates";

import { currencyInsight } from "./currency-insights";
import {
  auth0Enabled,
  auth0Config,
  verifyWalletIdentity,
  auth0UserInfo,
} from "./auth0";
import { onboardingRouter } from "./onboarding";
import {
  getServerSupabase,
  acceptSavingsRule,
  readIdempotentTransaction,
  supabaseEnabled,
  initializeProfile,
  readProfile,
  applyLedgerTransaction,
  updateProfilePreferences,
} from "./supabase";

validateDeploymentConfiguration(process.env);
export const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://www.sandbox.paypal.com",
          "https://*.paypalobjects.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          "https://*.sandbox.paypal.com",
          "https://*.paypalobjects.com",
          ...(supabaseEnabled()
            ? [new URL(process.env.SUPABASE_URL!).origin]
            : []),
          ...(auth0Config ? [`https://${auth0Config.domain}`] : []),
        ],
        frameSrc: [
          "https://*.sandbox.paypal.com",
          ...(auth0Config ? [`https://${auth0Config.domain}`] : []),
        ],
        workerSrc: ["'self'", "blob:"],
        imgSrc: [
          "'self'",
          "data:",
          "https://*.paypalobjects.com",
          "https://*.sandbox.paypal.com",
        ],
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
app.use(diagnostics);
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
  }),
);

app.use("/api", invitationPublicRouter);
app.get("/api/cron", async (req, res) => {
  if (
    !process.env.CRON_SECRET ||
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (sqlStorage()) await backendStorage.cleanup();
  await refreshRates();
  res.json({ ok: true });
});
app.use("/api", async (req, res, next) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = applicationOrigin();
      if (
        (origin && origin !== allowed) ||
        req.headers["x-walletwise"] !== "1"
      ) {
        res
          .status(403)
          .json({ error: "Request origin or protection header is invalid." });
        return;
      }
    }
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (auth0Enabled) {
      if (!token) {
        res.status(401).json({ error: "Please sign in to continue." });
        return;
      }
      const identity = await timed("auth_verify", () =>
        verifyWalletIdentity(token),
      );
      res.locals.uid = identity.uid;
      res.locals.sub = identity.sub;
      res.locals.idToken = token;
      res.locals.authMode = "auth0";
      registerUserIdentity(identity.uid, identity.sub);
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
  if (!supabaseEnabled()) {
    res.status(503).json({
      error:
        "Account setup is incomplete. Please contact the app administrator.",
    });
    return;
  }
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    try {
      // Request-local profile only: no cross-user/session cache and no auxiliary write.
      res.locals.profile =
        (await readProfile(res.locals.sub)) ??
        (await timed("db_initialize", () => initializeProfile(res.locals.sub)));
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
app.get("/api/bootstrap", async (_req, res) => {
  const loaded = await bootstrap(res.locals.sub, res.locals.profile);
  if (!loaded.onboarding.complete) {
    const identity = await auth0UserInfo(res.locals.idToken, res.locals.sub);
    loaded.onboarding.fullName ||= identity.name;
    loaded.onboarding.email ||= identity.email;
    loaded.onboarding.emailVerified =
      identity.emailVerified && loaded.onboarding.email === identity.email;
  }
  res.json(loaded);
});
app.use("/api", async (req, res, next) => {
  if (
    res.locals.authMode === "auth0" &&
    supabaseEnabled() &&
    req.path !== "/logout"
  ) {
    const profile = res.locals.profile;
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
app.use("/api", async (req, res, next) => {
  if (
    ["GET", "HEAD"].includes(req.method) ||
    req.path.startsWith("/funding") ||
    req.path === "/logout"
  ) {
    next();
    return;
  }
  const { data, error } = await getServerSupabase()
    .from("funding_orders")
    .select("id")
    .eq("auth0_sub", res.locals.sub)
    .eq("status", "REFUND_REVIEW")
    .limit(1);
  if (error) {
    res.status(503).json({ error: "Account storage is unavailable." });
    return;
  }
  if (data?.length) {
    res.status(409).json({
      error:
        "A payment reversal needs review before more wallet activity is allowed.",
    });
    return;
  }
  next();
});
app.use("/api", progressiveRouter);
app.get("/api/state", async (_req, res) => {
  if (res.locals.authMode === "auth0" && supabaseEnabled()) {
    const { data, walletBalances, savingsBalances } = await databaseState(
      res.locals.sub,
      res.locals.uid,
      res.locals.profile,
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
        firebase: false,
        paypal: fundingEnabled(),
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
      firebase: false,
      paypal: fundingEnabled(),
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
app.use("/api", circlesRouter);
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
      quoteId: z.uuid().nullable().optional(),
      skipSavings: z.boolean().default(false),
    })
    .parse(req.body);
  const fingerprint = JSON.stringify({ ...body, quoteId: undefined });
  res.json(
    await savingsRpc("walletwise_goal_purchase", {
      p_sub: res.locals.sub,
      p_key: body.requestId,
      p_fingerprint: fingerprint,
      p_currency: body.currency,
      p_amount: minor(body.amount, body.currency),
      p_description: body.description,
      p_category: body.category,
      p_quote: body.quoteId ?? null,
      p_skip: body.skipSavings,
    }),
  );
});
app.post("/api/refunds", async (req, res) => {
  const body = z.object({ requestId, id: z.uuid() }).parse(req.body);
  res.json(
    await savingsRpc("walletwise_goal_refund", {
      p_sub: res.locals.sub,
      p_key: body.requestId,
      p_original: body.id,
    }),
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
    ILS: id.nullable().optional(),
    USD: id.nullable().optional(),
    JOD: id.nullable().optional(),
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
app.put("/api/savings/default", async (req, res) => {
  const body = z
    .object({ currency, goalId: z.uuid().nullable() })
    .parse(req.body);
  if (!body.goalId) {
    res.json(
      await updateProfilePreferences(res.locals.sub, { savings: "disabled" }),
    );
    return;
  }
  res.json(
    await savingsRpc("walletwise_set_savings_destination", {
      p_sub: res.locals.sub,
      p_kind: "goal",
      p_id: body.goalId,
      p_enable: true,
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
      makeDefault: z.boolean().default(false),
      targetDate: z.iso.date().optional(),
    })
    .parse(req.body);
  await userRead(res.locals.uid);
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_create_savings_goal",
    {
      p_sub: res.locals.sub,
      p_uid: res.locals.uid,
      p_key: body.requestId,
      p_fingerprint: JSON.stringify(body),
      p_goal: {
        name: body.name,
        currency: body.currency,
        target: minor(body.amount, body.currency),
        targetDate: body.targetDate,
      },
      p_default: body.makeDefault,
    },
  );
  if (error) throw databaseError(error);
  res.json(data);
});
app.delete("/api/goals/:id", async (req, res) => {
  const goalId = z.uuid().parse(req.params.id);
  const { error } = await getServerSupabase().rpc(
    "walletwise_archive_savings_goal",
    {
      p_sub: res.locals.sub,
      p_uid: res.locals.uid,
      p_goal: goalId,
    },
  );
  if (error) throw databaseError(error);
  res.json({ archived: true });
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
  const { frequency, date, timezone } = z
    .object({
      frequency: z.enum(["weekly", "monthly"]),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      timezone: z.string().max(80).default("UTC"),
    })
    .strict()
    .parse(req.body);
  try {
    const { reportPeriod } = await import("../shared/report-period");
    reportPeriod(frequency, Date.now(), date, timezone);
  } catch {
    throw new ServiceError("Choose a valid reporting date and timezone.", 400);
  }
  const data = (await databaseState(res.locals.sub, res.locals.uid)).data;
  const { report: result, recommendations } = await (
    await import("./reports")
  ).generateSavedReport(
    res.locals.sub,
    res.locals.uid,
    data,
    frequency,
    date,
    timezone,
  );
  await userUpdate(res.locals.uid, (data) => {
    data.reports = data.reports.filter((r) => r.id !== result.id);
    data.reports.unshift(result);
    data.reports = data.reports.slice(0, 24);
    const existingIds = new Set(data.recommendations.map((r) => r.id));
    data.recommendations.forEach((r) => {
      if (r.status === "pending" && r.reportId !== result.id)
        r.status = "dismissed";
    });
    data.recommendations.unshift(
      ...recommendations.filter((r) => !existingIds.has(r.id)),
    );
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
    if (!rule) throw new ServiceError("Recommendation not found.", 404);
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
app.use("/api/funding", fundingRouter);
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
      if (
        "retryAfter" in err &&
        typeof err.retryAfter === "number" &&
        err.retryAfter
      )
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
