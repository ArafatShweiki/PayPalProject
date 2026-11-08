import { Router } from "express";
import { z } from "zod";
import { buildCoach, type CoachInput } from "../shared/coach.js";
import { savingsRpc } from "./savings-circles.js";
import { cachedExplanation } from "./ai.js";
import { fingerprint } from "./reliability.js";
import { userUpdate } from "./store.js";
const minor = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const inputSchema = z.object({
  spending: z
    .array(
      z.object({
        currency: z.enum(["ILS", "USD", "JOD"]),
        category: z.string().max(80),
        gross: minor,
        refunds: minor,
        net: minor,
        previous: minor.nullable(),
        count: minor.nonnegative(),
      }),
    )
    .optional(),
  asOf: z.iso.datetime({ offset: true }),
  goals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      currency: z.enum(["ILS", "USD", "JOD"]),
      target: minor.positive(),
      saved: minor.nonnegative(),
      createdAt: z.iso.datetime({ offset: true }),
      targetDate: z.string().optional(),
      archived: z.boolean().optional(),
    }),
  ),
  samples: z.array(
    z.object({
      goalId: z.string().nullable(),
      at: z.iso.datetime({ offset: true }),
      amount: minor,
      paceAmount: minor,
    }),
  ),
  available: z.object({
    ILS: minor.nonnegative(),
    USD: minor.nonnegative(),
    JOD: minor.nonnegative(),
  }),
  guide: z.object({
    dismissed: z.boolean(),
    walletViewed: z.boolean(),
    circlesViewed: z.boolean(),
  }),
  steps: z.object({
    funded: z.boolean(),
    goal: z.boolean(),
    enabled: z.boolean(),
    purchased: z.boolean(),
  }),
});
export async function loadCoach(sub: string, uid: string) {
  const parsed = inputSchema.parse(
    await savingsRpc("walletwise_coach", { p_sub: sub, p_uid: uid }),
  );
  return buildCoach({
    ...parsed,
    samples: parsed.samples.filter((s) => s.goalId !== null),
  } as CoachInput);
}
export async function explainCoach(
  result: ReturnType<typeof buildCoach>,
  uid: string,
) {
  // No names, descriptions, identifiers or instructions from user text reach the model.
  const facts = result.outlooks
    .filter((g) => !g.archived)
    .map((g) => ({
      currency: g.currency,
      status: g.status,
      remaining: g.remaining,
      weekly: g.weekly,
      daysObserved: g.daysObserved,
      completion: g.completion?.slice(0, 10) ?? null,
    }));
  const permitted: string[] = [];
  if (facts.some((f) => f.status === "insufficient"))
    permitted.push(
      "More recorded savings history is needed before projecting a date.",
    );
  if (facts.some((f) => f.status === "estimated"))
    permitted.push(
      "Your outlook extends the recent net saving pace; future contributions can change.",
    );
  if (facts.some((f) => f.status === "stalled"))
    permitted.push(
      "Recent reversals offset contributions, so a positive saving pace cannot yet be projected.",
    );
  if (facts.some((f) => f.status === "completed"))
    permitted.push(
      "A recorded personal goal has reached its target. Review your next savings destination.",
    );
  if (!permitted.length) return undefined;
  try {
    const explanation = await cachedExplanation(
      { facts, permitted },
      "Select the most useful applicable explanation from permitted. Copy that sentence verbatim into a single observations item. Do not compose new text, numbers, dates, promises or instructions. Return JSON observations.",
      `coach:${fingerprint(uid)}`,
    );
    const sentence = explanation?.value?.[0];
    // Numeric results are exclusively rendered from deterministic fields.
    return sentence && permitted.includes(sentence) ? sentence : undefined;
  } catch {
    return undefined;
  }
}
export const coachRouter = Router();
coachRouter.get("/savings/coach", async (_req, res) =>
  res.json(await loadCoach(res.locals.sub, res.locals.uid)),
);
coachRouter.post("/savings/coach/explain", async (_req, res) => {
  const result = await loadCoach(res.locals.sub, res.locals.uid);
  const explanation = await explainCoach(result, res.locals.uid);
  res.json({
    ...result,
    explanation,
    explanationStatus: explanation ? "ready" : "unavailable",
  });
});
coachRouter.put("/guide", async (req, res) => {
  const body = z
    .object({
      dismissed: z.boolean().optional(),
      walletViewed: z.literal(true).optional(),
      circlesViewed: z.literal(true).optional(),
    })
    .strict()
    .parse(req.body);
  res.json(
    await userUpdate(res.locals.uid, (data) => {
      data.guide = { ...data.guide, ...body };
      return data.guide;
    }),
  );
});
