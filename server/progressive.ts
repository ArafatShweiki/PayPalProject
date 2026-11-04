import { Router } from "express";
import { z } from "zod";
import { getServerSupabase, type StoredTransaction } from "./supabase";
import { mapTransaction } from "./database-state";
import { userRead } from "./store";
import { databaseError } from "./database-errors";
import type { ActivityPage, FundingOrder, State, Entry } from "../shared/types";
import { timed } from "./diagnostics";
const router = Router();
router.get("/dashboard", async (req, res) => {
  const timezone = z.string().max(80).default("UTC").parse(req.query.timezone);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    res.status(400).json({ error: "Choose a valid time zone." });
    return;
  }
  const load = () =>
    timed("db_overview", () =>
      getServerSupabase().rpc("walletwise_dashboard", {
        p_sub: res.locals.sub,
        p_uid: res.locals.uid,
        p_timezone: timezone,
      }),
    );
  let result = await load();
  if (result.error) throw databaseError(result.error);
  if (!result.data) {
    await userRead(res.locals.uid, res.locals.profile);
    result = await load();
    if (result.error) throw databaseError(result.error);
  }
  if (!result.data) throw new Error("Account storage is unavailable.");
  const data = result.data as Pick<
    State,
    | "goals"
    | "alerts"
    | "notices"
    | "reports"
    | "recommendations"
    | "createdAt"
    | "dashboard"
  >;
  if (
    !data.dashboard ||
    !Array.isArray(data.dashboard.dailySpending) ||
    !data.dashboard.goalTotals ||
    !["goals", "alerts", "notices", "reports", "recommendations"].every((key) =>
      Array.isArray((data as unknown as Record<string, unknown>)[key]),
    )
  )
    throw new Error("Account totals are unavailable.");
  const safe = (v: unknown) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n))
      throw new Error("Account totals are unavailable.");
    return n;
  };
  for (const row of data.dashboard?.dailySpending || [])
    row.amount = safe(row.amount);
  for (const [id, value] of Object.entries(data.dashboard?.goalTotals || {}))
    data.dashboard!.goalTotals[id] = safe(value);
  if (data.dashboard.generalSavings)
    for (const currency of ["ILS", "USD", "JOD"] as const)
      data.dashboard.generalSavings[currency] = safe(
        data.dashboard.generalSavings[currency],
      );
  if (data.dashboard.circleSavings)
    for (const currency of ["ILS", "USD", "JOD"] as const)
      data.dashboard.circleSavings[currency] = safe(
        data.dashboard.circleSavings[currency],
      );
  res.json(data);
});
router.get("/activity", async (req, res) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().max(400).optional(),
      currency: z.enum(["USD", "ILS", "JOD"]).optional(),
      category: z.string().max(80).optional(),
      savings: z.enum(["true", "false"]).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
    })
    .parse(req.query);
  let before: { at: string; id: string } | undefined;
  if (query.cursor) {
    try {
      before = z
        .object({ at: z.iso.datetime({ offset: true }), id: z.uuid() })
        .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
    } catch {
      res.status(400).json({
        error:
          "This activity page is unavailable. Please reload the first page.",
      });
      return;
    }
  }
  const { data, error } = await timed("db_activity", () =>
    getServerSupabase().rpc("walletwise_activity_page", {
      p_sub: res.locals.sub,
      p_before: before?.at ?? null,
      p_before_id: before?.id ?? null,
      p_limit: query.limit + 1,
      p_currency: query.currency ?? null,
      p_category: query.category ?? null,
      p_savings: query.savings === "true",
      p_from: query.from ? `${query.from}T00:00:00Z` : null,
      p_until: query.to
        ? new Date(Date.parse(`${query.to}T00:00:00Z`) + 86400000).toISOString()
        : null,
    }),
  );
  if (error) throw databaseError(error);
  const rows = (data || []) as (StoredTransaction & {
    funding?: FundingOrder;
  })[];
  const page = rows.slice(0, query.limit),
    last = page.at(-1);
  const entries: Entry[] = page.map((row) =>
    row.funding
      ? {
          id: row.funding.id,
          at: row.funding.created_at,
          kind: "funding",
          currency: row.funding.currency,
          amount: Number(row.funding.amount_minor),
          saved: 0,
          description: "Funds Added",
          category: "Funding",
          status: row.funding.status,
          fundingSource: "PayPal",
          reference: row.funding.provider_order_id || row.id,
          postings: [],
        }
      : mapTransaction(row),
  );
  res.json({
    entries,
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.occurred_at, id: last.id }),
          ).toString("base64url")
        : null,
  } satisfies ActivityPage);
});
router.get("/account/reports", async (req, res) => {
  const { offset, limit } = z
    .object({
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .parse(req.query);
  const { data, error } = await getServerSupabase().rpc(
    "walletwise_report_page",
    {
      p_sub: res.locals.sub,
      p_uid: res.locals.uid,
      p_offset: offset,
      p_limit: limit,
    },
  );
  if (error) throw databaseError(error);
  res.json(data || { reports: [], total: 0 });
});
export { router as progressiveRouter };
