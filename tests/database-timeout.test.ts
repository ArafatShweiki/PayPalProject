import { it, expect, vi, afterEach } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("bounds stalled database reads and returns a recoverable storage error", async () => {
  vi.stubEnv("AUTH0_ENABLED", "true");
  vi.stubEnv("SUPABASE_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_fixture");
  vi.stubEnv("SUPABASE_REQUEST_TIMEOUT_MS", "1000");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "TimeoutError")),
            { once: true },
          );
        }),
    ),
  );
  const { readWallets } = await import("../server/supabase");
  const start = performance.now();
  await expect(readWallets("auth0|fixture")).rejects.toMatchObject({
    status: 503,
  });
  expect(performance.now() - start).toBeLessThan(2500);
  expect(fetch).toHaveBeenCalledOnce();
}, 5000);
