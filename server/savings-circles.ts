import { Router } from "express";
import { applicationOrigin } from "./configuration";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { currencies, minor, roundUp, convert } from "../shared/money";
import { isQuoteStale, snapshotRate, pairTime } from "../shared/market";
import type { SavingsOptions } from "../shared/circles";
import type { CircleDetail } from "../shared/circles";
import {
  getServerSupabase,
  readProfile,
  readSavingsRules,
  readIdempotentTransaction,
} from "./supabase";
import { snapshots } from "./store";
import { refreshRates, rateStaleMs } from "./rates";
import { databaseError, DatabaseError } from "./database-errors";
const currency = z.enum(currencies),
  key = z.uuid(),
  amount = z.string().max(20),
  destination = z.object({ kind: z.enum(["goal", "circle"]), id: z.uuid() });
export async function savingsRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await getServerSupabase().rpc(name, args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "PGRST205")
      throw new DatabaseError(
        "Savings setup needs an application update. Please contact the app administrator.",
        503,
      );
    throw databaseError(error);
  }
  return data as T;
}
export const savingsOptions = (sub: string) =>
  savingsRpc<SavingsOptions>("walletwise_savings_options", { p_sub: sub });
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const invitationPublicRouter = Router();
invitationPublicRouter.get("/circles/invite/:token", async (req, res) => {
  const value = token.parse(req.params.token);
  const preview = await savingsRpc("walletwise_invitation_preview", {
    p_hash: hash(value),
  });
  if (!preview) {
    res
      .status(404)
      .json({ error: "This invitation is invalid, revoked, or expired." });
    return;
  }
  res.json(preview);
});
export async function issueSavingsQuote(
  sub: string,
  from: z.infer<typeof currency>,
  sourceMinor: number,
  dest: z.infer<typeof destination>,
) {
  const options = await savingsOptions(sub);
  const goal = options.options.find(
    (o) => o.id === dest.id && o.kind === dest.kind,
  );
  if (!goal)
    throw new DatabaseError(
      "Choose an eligible savings goal before saving.",
      409,
    );
  if (dest.kind === "circle") {
    const circle = await savingsRpc<CircleDetail>("walletwise_circles", {
      p_sub: sub,
      p_id: dest.id,
    });
    if (
      circle.proposals.some(
        (p) =>
          ["Pending", "Approved", "Executing", "Failed"].includes(p.status) &&
          Date.parse(p.expiresAt) > Date.now(),
      )
    )
      throw new DatabaseError(
        "Your circle is locked for a vote. Retry after the request is resolved, or explicitly continue without a round-up.",
        409,
      );
  }
  let rate = 1000000,
    source = "Same currency",
    observed = new Date().toISOString(),
    snapshotId = "same-currency",
    expires = Date.now() + 120000;
  if (from !== goal.currency) {
    await refreshRates();
    const snapshot = (await snapshots()).at(-1);
    if (!snapshot || isQuoteStale(snapshot, from, goal.currency, rateStaleMs()))
      throw new DatabaseError(
        "A fresh savings conversion quote is unavailable. No round-up will be deducted unless you retry successfully.",
        409,
      );
    rate = snapshotRate(snapshot, from, goal.currency);
    source = snapshot.source;
    observed = pairTime(snapshot, from, goal.currency);
    snapshotId = snapshot.id;
    expires = Math.min(
      Date.now() + 60000,
      Date.parse(observed) + rateStaleMs(),
    );
  }
  const received = convert(sourceMinor, from, goal.currency, rate);
  if (received <= 0)
    throw new DatabaseError(
      "This round-up is too small to credit the goal currency. No round-up will be deducted.",
      409,
    );
  const { data, error } = await getServerSupabase()
    .from("savings_quotes")
    .insert({
      auth0_sub: sub,
      destination_kind: dest.kind,
      destination_id: dest.id,
      source_currency: from,
      source_minor: sourceMinor,
      target_currency: goal.currency,
      target_minor: received,
      rate_units: rate,
      source,
      observed_at: observed,
      expires_at: new Date(expires).toISOString(),
      snapshot_id: snapshotId,
    })
    .select("*")
    .single();
  if (error) throw databaseError(error);
  const { auth0_sub: _, ...quote } = data;
  void _;
  return quote;
}
export const circlesRouter = Router();
circlesRouter.get("/savings/options", async (_req, res) =>
  res.json(await savingsOptions(res.locals.sub)),
);
circlesRouter.put("/savings/destination", async (req, res) => {
  const body = destination
    .extend({ enable: z.boolean().default(true) })
    .parse(req.body);
  res.json(
    await savingsRpc("walletwise_set_savings_destination", {
      p_sub: res.locals.sub,
      p_kind: body.kind,
      p_id: body.id,
      p_enable: body.enable,
    }),
  );
});
circlesRouter.post("/savings/preview", async (req, res) => {
  const body = z
    .object({
      currency,
      amount,
      destination: destination.optional(),
      purchase: z.boolean().default(false),
    })
    .parse(req.body);
  let value = minor(body.amount, body.currency);
  if (body.purchase) {
    const rules = await readSavingsRules(res.locals.sub),
      profile = await readProfile(res.locals.sub);
    const rule = rules.find((r) => r.currency === body.currency);
    if (!profile?.savings_enabled || !rule?.enabled) {
      res.json({ quote: null, saved: 0 });
      return;
    }
    value = roundUp(
      value,
      Number(rule.increment_minor),
      Number(rule.cap_minor),
    );
    if (!value) {
      res.json({ quote: null, saved: 0 });
      return;
    }
  }
  const selected =
    body.destination ||
    (await readProfile(res.locals.sub))?.wallet_preferences.savingsDestination;
  if (!selected)
    throw new DatabaseError("Choose a savings goal before saving.", 409);
  res.json({
    quote: await issueSavingsQuote(
      res.locals.sub,
      body.currency,
      value,
      selected,
    ),
    saved: value,
  });
});
circlesRouter.post("/savings/assign", async (req, res) => {
  const body = z
    .object({ requestId: key, goalId: key, currency, amount })
    .parse(req.body);
  const choices = await savingsOptions(res.locals.sub);
  if (
    !choices.options.some(
      (o) =>
        o.kind === "goal" &&
        o.id === body.goalId &&
        o.currency === body.currency,
    )
  )
    throw new DatabaseError(
      "Choose an eligible personal goal in the savings currency.",
      409,
    );
  res.json(
    await savingsRpc("walletwise_assign_historical", {
      p_sub: res.locals.sub,
      p_key: body.requestId,
      p_goal: body.goalId,
      p_amount: minor(body.amount, body.currency),
    }),
  );
});
circlesRouter.get("/circles", async (_req, res) =>
  res.json(await savingsRpc("walletwise_circles", { p_sub: res.locals.sub })),
);
circlesRouter.get("/circles/:id", async (req, res) =>
  res.json(
    await savingsRpc("walletwise_circles", {
      p_sub: res.locals.sub,
      p_id: key.parse(req.params.id),
    }),
  ),
);
circlesRouter.post("/circles", async (req, res) => {
  const body = z
    .object({
      requestId: key,
      name: z.string().trim().min(1).max(60),
      description: z.string().trim().max(500).default(""),
      currency,
      amount,
      targetDate: z.iso.date().optional(),
      icon: z
        .enum(["users", "home", "plane", "heart", "target"])
        .default("users"),
    })
    .parse(req.body);
  res.json(
    await savingsRpc("walletwise_circle_command", {
      p_sub: res.locals.sub,
      p_action: "create",
      p_id: null,
      p_key: body.requestId,
      p_payload: {
        ...body,
        target: minor(body.amount, body.currency),
        requestId: undefined,
        amount: undefined,
      },
    }),
  );
});
circlesRouter.get("/circles/invitations/:token", async (req, res) => {
  const value = token.parse(req.params.token);
  const status = await savingsRpc("walletwise_invitation_status", {
    p_sub: res.locals.sub,
    p_hash: hash(value),
  });
  if (!status) {
    res
      .status(404)
      .json({ error: "This invitation is invalid, revoked, or expired." });
    return;
  }
  res.json(status);
});
circlesRouter.post("/circles/join", async (req, res) => {
  const body = z.object({ requestId: key, token }).parse(req.body);
  res.json(
    await savingsRpc("walletwise_join_circle", {
      p_sub: res.locals.sub,
      p_hash: hash(body.token),
      p_key: body.requestId,
    }),
  );
});
circlesRouter.post("/circles/:id/contribute", async (req, res) => {
  const body = z
    .object({
      requestId: key,
      currency,
      amount,
      quoteId: key,
      sourceGoal: key.nullable().optional(),
      confirmed: z.literal(true),
    })
    .parse(req.body);
  const fingerprint = JSON.stringify(body),
    replay = await readIdempotentTransaction(
      res.locals.sub,
      body.requestId,
      fingerprint,
    );
  if (replay) {
    res.json(replay);
    return;
  }
  res.json(
    await savingsRpc("walletwise_circle_contribute", {
      p_sub: res.locals.sub,
      p_id: key.parse(req.params.id),
      p_key: body.requestId,
      p_fingerprint: fingerprint,
      p_currency: body.currency,
      p_amount: minor(body.amount, body.currency),
      p_quote: body.quoteId,
      p_source_goal: body.sourceGoal ?? null,
    }),
  );
});
circlesRouter.post("/circles/:id/invite", async (req, res) => {
  const id = key.parse(req.params.id),
    body = z.object({ requestId: key }).parse(req.body),
    raw = randomBytes(32).toString("base64url");
  await savingsRpc("walletwise_circle_command", {
    p_sub: res.locals.sub,
    p_action: "invite",
    p_id: id,
    p_key: body.requestId,
    p_payload: { hash: hash(raw) },
  });
  res.json({
    url: `${applicationOrigin()}/circles/invite/${raw}`,
    expiresInDays: 7,
  });
});
circlesRouter.post("/circles/:id/actions", async (req, res) => {
  const body = z
    .discriminatedUnion("action", [
      z.object({
        requestId: key,
        action: z.enum(["revoke", "leave", "archive", "request_return"]),
      }),
      z.object({
        requestId: key,
        action: z.literal("propose"),
        kind: z.enum([
          "withdraw",
          "target",
          "return_all",
          "return_member",
          "owner",
        ]),
        amount,
        currency,
        destination: key.nullable(),
        reason: z.string().trim().min(1).max(500),
        confirmed: z.literal(true),
      }),
      z.object({
        requestId: key,
        action: z.literal("vote"),
        proposalId: key,
        decision: z.enum(["Approve", "Reject"]),
      }),
      z.object({
        requestId: key,
        action: z.enum(["execute", "cancel"]),
        proposalId: key,
      }),
    ])
    .parse(req.body);
  let payload: Record<string, unknown> = { ...body };
  delete payload.requestId;
  delete payload.action;
  if (body.action === "propose")
    payload = {
      ...payload,
      amount: body.kind === "owner" ? 0 : minor(body.amount, body.currency),
    };
  res.json(
    await savingsRpc("walletwise_circle_command", {
      p_sub: res.locals.sub,
      p_action: body.action,
      p_id: key.parse(req.params.id),
      p_key: body.requestId,
      p_payload: payload,
    }),
  );
});
