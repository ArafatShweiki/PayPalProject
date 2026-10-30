import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { isIP } from "node:net";
import { update } from "./store";
export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 503,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export const setting = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
export const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export type Counter = { count: number; reset: number };
export function consumeCounter(
  prior: Counter | undefined,
  limit: number,
  windowMs: number,
  now = Date.now(),
) {
  const bucket =
    !prior || prior.reset <= now
      ? { count: 0, reset: now + windowMs }
      : { ...prior };
  const allowed = bucket.count < limit;
  if (allowed) bucket.count++;
  return {
    allowed,
    bucket,
    retryAfter: Math.max(1, Math.ceil((bucket.reset - now) / 1000)),
  };
}
// Shared store transactions are Firestore in serverless deployments and SQLite locally.
// Fixed shards bound record growth; expired identities are pruned on every access.
export async function consumeLimit(
  scope: string,
  identity: string,
  limit: number,
  windowMs = 60000,
) {
  const key = fingerprint(identity);
  return update<Record<string, Counter>, ReturnType<typeof consumeCounter>>(
    `limit_${scope}_${key.slice(0, 2)}`,
    () => ({}),
    (buckets) => {
      const now = Date.now();
      for (const [id, bucket] of Object.entries(buckets))
        if (bucket.reset <= now) delete buckets[id];
      if (!buckets[key] && Object.keys(buckets).length >= 2000)
        throw new ServiceError(
          "Service is busy. Please try again shortly.",
          503,
        );
      const result = consumeCounter(buckets[key], limit, windowMs, now);
      buckets[key] = result.bucket;
      return result;
    },
  );
}
export function trustedIp(req: {
  get: (name: string) => string | undefined;
  socket: { remoteAddress?: string };
}) {
  const forwarded = process.env.VERCEL
    ? req.get("x-vercel-forwarded-for") || req.get("x-forwarded-for")
    : undefined;
  const candidate = forwarded?.split(",").at(-1)?.trim();
  return candidate && isIP(candidate)
    ? candidate
    : req.socket.remoteAddress || "unknown";
}
export const limitMiddleware =
  (
    scope: string,
    envName: string,
    fallback: number,
    user = false,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      const identity = user ? String(res.locals.uid) : trustedIp(req);
      const result = await consumeLimit(
        scope,
        identity,
        setting(envName, fallback),
      );
      if (!result.allowed) {
        res.setHeader("Retry-After", result.retryAfter);
        console.warn(
          JSON.stringify({
            event: "rate_limit",
            operation: scope,
            requestId: res.locals.requestId,
          }),
        );
        res
          .status(429)
          .json({
            error: "Too many requests. Please try again shortly.",
            requestId: res.locals.requestId,
          });
        return;
      }
      next();
    } catch {
      next(
        new ServiceError(
          "Request protection is temporarily unavailable. Please try again later.",
        ),
      );
    }
  };
export async function withLease<T>(
  scope: string,
  slots: number,
  work: () => Promise<T>,
  duration = 30000,
): Promise<T> {
  const owner = randomUUID();
  await update<Record<string, number>, void>(
    `lease_${fingerprint(scope)}`,
    () => ({}),
    (leases) => {
      for (const [id, expiry] of Object.entries(leases))
        if (expiry <= Date.now()) delete leases[id];
      if (Object.keys(leases).length >= slots)
        throw new ServiceError(
          "This service is busy. Please try again shortly.",
          429,
          3,
        );
      leases[owner] = Date.now() + duration;
    },
  );
  try {
    return await work();
  } finally {
    await update<Record<string, number>, void>(
      `lease_${fingerprint(scope)}`,
      () => ({}),
      (leases) => {
        delete leases[owner];
      },
    );
  }
}
type Memo<T> = { key: string; expires: number; generatedAt: string; value: T };
const pending = new Map<
  string,
  Promise<{ value: unknown; generatedAt: string; cached: boolean }>
>();
export async function remember<T>(
  scope: string,
  input: unknown,
  ttl: number,
  work: () => Promise<T>,
  reusable: (value: T) => boolean = () => true,
): Promise<{ value: T; generatedAt: string; cached: boolean }> {
  const key = fingerprint(input),
    id = `cache_${fingerprint(scope)}`,
    pendingKey = `${id}:${key}`;
  const inflight = pending.get(pendingKey);
  if (inflight)
    return inflight as Promise<{
      value: T;
      generatedAt: string;
      cached: boolean;
    }>;
  const load = async () => {
    const hit = await update<{ record?: Memo<T> }, Memo<T> | undefined>(
      id,
      () => ({}),
      (state) => {
        if (state.record?.key === key && state.record.expires > Date.now())
          return state.record;
        delete state.record;
        return undefined;
      },
    );
    if (hit)
      return { value: hit.value, generatedAt: hit.generatedAt, cached: true };
    return withLease(id, 1, async () => {
      const value = await work(),
        generatedAt = new Date().toISOString();
      if (reusable(value))
        await update<{ record?: Memo<T> }, void>(
          id,
          () => ({}),
          (state) => {
            state.record = {
              key,
              expires: Date.now() + ttl,
              generatedAt,
              value,
            };
          },
        );
      return { value, generatedAt, cached: false };
    });
  };
  const promise = load().finally(() => pending.delete(pendingKey));
  pending.set(pendingKey, promise);
  return promise;
}
