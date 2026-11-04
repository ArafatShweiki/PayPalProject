import { it, expect, vi } from "vitest";
import { sdkIdTokenProvider } from "../src/supabase";
import { RequestCache } from "../src/requestCache";
it("refuses a cached token belonging to a different SDK subject", async () => {
  const token = sdkIdTokenProvider(
    async () => ({
      __raw: "old",
      role: "authenticated",
      sub: "auth0|a",
      exp: Date.now() / 1000 + 3600,
    }),
    async () => {},
    true,
    "auth0|b",
  );
  await expect(token()).rejects.toThrow("identity changed");
});
it("reuses valid SDK ID-token claims without silent access-token requests", async () => {
  const claims = vi.fn(async () => ({
      __raw: "signed-id-token",
      role: "authenticated",
      exp: Date.now() / 1000 + 3600,
    })),
    renew = vi.fn();
  const token = sdkIdTokenProvider(claims, renew);
  expect(await Promise.all([token(), token(), token()])).toEqual([
    "signed-id-token",
    "signed-id-token",
    "signed-id-token",
  ]);
  expect(claims).toHaveBeenCalledOnce();
  expect(renew).not.toHaveBeenCalled();
});
it("coalesces an expired-token renewal and continues enforcing the authenticated role", async () => {
  let current = { __raw: "expired", role: "authenticated", exp: 1 };
  const claims = vi.fn(async () => current),
    renew = vi.fn(async () => {
      current = {
        __raw: "renewed",
        role: "authenticated",
        exp: Date.now() / 1000 + 3600,
      };
      return "opaque-access-token";
    });
  const token = sdkIdTokenProvider(claims, renew);
  expect(await Promise.all([token(), token()])).toEqual(["renewed", "renewed"]);
  expect(renew).toHaveBeenCalledOnce();
  const invalid = sdkIdTokenProvider(
    async () => ({ ...current, role: "other" }),
    renew,
  );
  await expect(invalid()).rejects.toThrow("authenticated");
});
it("cancels obsolete consumers without aborting a read still needed by another component", async () => {
  const cache = new RequestCache(),
    first = new AbortController(),
    second = new AbortController();
  let release!: (v: string) => void;
  let signal!: AbortSignal;
  const load = vi.fn((s: AbortSignal) => {
    signal = s;
    return new Promise<string>((r) => {
      release = r;
    });
  });
  const a = cache.get("same-user", 1000, load, first.signal),
    b = cache.get("same-user", 1000, load, second.signal);
  first.abort();
  await expect(a).rejects.toMatchObject({ name: "AbortError" });
  expect(signal.aborted).toBe(false);
  release("owned");
  await expect(b).resolves.toBe("owned");
  expect(load).toHaveBeenCalledOnce();
});
it("aborts the network read when its last consumer leaves and never reuses that result", async () => {
  const cache = new RequestCache(),
    controller = new AbortController();
  let release!: (v: string) => void, signal!: AbortSignal;
  const pending = cache.get(
    "key",
    1000,
    (s) => {
      signal = s;
      return new Promise<string>((r) => {
        release = r;
      });
    },
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(signal.aborted).toBe(true);
  release("old");
  expect(await cache.get("key", 1000, async () => "new")).toBe("new");
});
