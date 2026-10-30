import { afterEach, expect, it, vi } from "vitest";
import {
  RequestCache,
  cacheScope,
  clearPrivateCache,
} from "../src/requestCache";
afterEach(() => vi.useRealTimers());
it("deduplicates reads, honors TTL, and returns fresh values after invalidation", async () => {
  let now = 100;
  const cache = new RequestCache(() => now),
    load = vi.fn(async () => ({ balance: 10 }));
  const [a, b] = await Promise.all([
    cache.get("alice:state", 50, load),
    cache.get("alice:state", 50, load),
  ]);
  expect(a).toEqual(b);
  expect(load).toHaveBeenCalledTimes(1);
  a.balance = 0;
  expect(await cache.get("alice:state", 50, load)).toEqual({ balance: 10 });
  now = 151;
  await cache.get("alice:state", 50, load);
  expect(load).toHaveBeenCalledTimes(2);
  cache.clear();
  await cache.get("alice:state", 50, load);
  expect(load).toHaveBeenCalledTimes(3);
  await cache.get("bob:state", 50, load);
  expect(load).toHaveBeenCalledTimes(4);
});
it("aborts obsolete reads and changes the account generation on cleanup", async () => {
  const cache = new RequestCache();
  let signal!: AbortSignal;
  const read = cache.get("alice", 0, async (s) => {
    signal = s;
    return 1;
  });
  cache.clear();
  expect(signal.aborted).toBe(true);
  await expect(read).rejects.toMatchObject({ name: "AbortError" });
  const old = cacheScope();
  clearPrivateCache();
  expect(cacheScope()).toBeGreaterThan(old);
});
it("does not cache failures", async () => {
  const cache = new RequestCache(),
    fail = vi.fn(async () => {
      throw new Error("offline");
    });
  await expect(cache.get("key", 100, fail)).rejects.toThrow("offline");
  await expect(cache.get("key", 100, fail)).rejects.toThrow("offline");
  expect(fail).toHaveBeenCalledTimes(2);
});
