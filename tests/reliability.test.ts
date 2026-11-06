import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { backendStorage, BackendLeaseBusy } from "../server/backend-storage";
import {
  consumeCounter,
  consumeLimit,
  fingerprint,
  remember,
  trustedIp,
  withLease,
  limitMiddleware,
  ServiceError,
} from "../server/reliability";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("preserves the provider ServiceError contract for SQL lease contention", async () => {
  vi.stubEnv("STORAGE", "supabase");
  vi.spyOn(backendStorage, "withLease").mockRejectedValue(
    new BackendLeaseBusy(),
  );
  await expect(
    withLease("provider", 1, async () => null),
  ).rejects.toBeInstanceOf(ServiceError);
  await expect(
    withLease("provider", 1, async () => null),
  ).rejects.toMatchObject({ status: 429, retryAfter: 3 });
});
it("fails closed before sensitive work when the PostgreSQL limiter is unavailable", async () => {
  vi.stubEnv("STORAGE", "supabase");
  vi.spyOn(backendStorage, "consume").mockRejectedValue(
    new Error("private SQL failure"),
  );
  const next = vi.fn();
  const req = {
    get: () => undefined,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
  const res = { locals: { uid: "alice" } } as unknown as Response;
  await limitMiddleware(
    "financial",
    "RATE_LIMIT_FINANCIAL",
    30,
    true,
  )(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toMatchObject({ status: 503 });
  expect(next.mock.calls[0][0].message).not.toContain("private SQL");
});
it("uses stable fingerprint keys and enforces the window boundary", () => {
  expect(fingerprint({ user: "a", period: "weekly" })).toBe(
    fingerprint({ user: "a", period: "weekly" }),
  );
  expect(fingerprint({ user: "a" })).not.toBe(fingerprint({ user: "b" }));
  const first = consumeCounter(undefined, 1, 1000, 500);
  expect(first.allowed).toBe(true);
  expect(consumeCounter(first.bucket, 1, 1000, 600)).toMatchObject({
    allowed: false,
    retryAfter: 1,
  });
  expect(consumeCounter(first.bucket, 1, 1000, 1500).allowed).toBe(true);
});
it("atomically shares durable limits across concurrent calls and isolates users", async () => {
  const scope = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => consumeLimit(scope, "alice", 2)),
  );
  expect(results.filter((r) => r.allowed)).toHaveLength(2);
  expect((await consumeLimit(scope, "bob", 2)).allowed).toBe(true);
});
it("ignores spoofed proxy headers outside Vercel", () => {
  const req = {
    get: () => "203.0.113.99",
    socket: { remoteAddress: "127.0.0.1" },
  };
  expect(trustedIp(req)).toBe("127.0.0.1");
  vi.stubEnv("VERCEL", "1");
  expect(trustedIp(req)).toBe("203.0.113.99");
});
it("reuses unchanged results, invalidates by financial fingerprint and isolates account keys", async () => {
  const scope = randomUUID(),
    work = vi.fn(async () => ["an explanation"]);
  const a = await remember(
    `${scope}:alice`,
    { ledger: "v1", frequency: "weekly", model: "m1" },
    10000,
    work,
  );
  const b = await remember(
    `${scope}:alice`,
    { ledger: "v1", frequency: "weekly", model: "m1" },
    10000,
    work,
  );
  expect(a.cached).toBe(false);
  expect(b.cached).toBe(true);
  expect(work).toHaveBeenCalledTimes(1);
  await remember(
    `${scope}:alice`,
    { ledger: "v2", frequency: "weekly", model: "m1" },
    10000,
    work,
  );
  await remember(
    `${scope}:bob`,
    { ledger: "v2", frequency: "weekly", model: "m1" },
    10000,
    work,
  );
  expect(work).toHaveBeenCalledTimes(3);
});
it("expires cached values and deduplicates simultaneous generation", async () => {
  const scope = randomUUID(),
    work = vi.fn(async () => 42);
  await Promise.all([
    remember(scope, "v1", 1, work),
    remember(scope, "v1", 1, work),
  ]);
  expect(work).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await remember(scope, "v1", 1, work);
  expect(work).toHaveBeenCalledTimes(2);
});
it("releases concurrency leases after failure", async () => {
  const scope = randomUUID();
  let release!: () => void;
  const first = withLease(
    scope,
    1,
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await expect(withLease(scope, 1, async () => 1)).rejects.toMatchObject({
    status: 429,
    retryAfter: 3,
  });
  release();
  await first;
  expect(await withLease(scope, 1, async () => 2)).toBe(2);
});
