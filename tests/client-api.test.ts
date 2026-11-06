// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api, requestTimeoutMs, setAuth0TokenProvider } from "../src/api";
afterEach(() => {
  setAuth0TokenProvider();
  vi.unstubAllGlobals();
});
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
it("allows bounded provider workflows to finish without extending ordinary reads", () => {
  expect(requestTimeoutMs("/bootstrap")).toBe(12000);
  expect(requestTimeoutMs("/state")).toBe(20000);
  expect(requestTimeoutMs("/purchases")).toBe(20000);
  expect(requestTimeoutMs("/reports")).toBe(60000);
  expect(requestTimeoutMs("/funding/orders")).toBe(180000);
  expect(requestTimeoutMs("/funding/order-id/capture")).toBe(180000);
  expect(requestTimeoutMs("/funding/order-id/reconcile")).toBe(180000);
});
it("deduplicates private reads, invalidates after mutation and isolates account changes", async () => {
  const fetcher = vi.fn().mockImplementation(async () => json({ balance: 10 }));
  vi.stubGlobal("fetch", fetcher);
  setAuth0TokenProvider(async () => "alice");
  await Promise.all([api("/state"), api("/state")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await api("/state");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => json({ balance: 20 }));
  await api("/preferences", { name: "Alice" }, "PUT");
  expect(await api("/state")).toEqual({ balance: 20 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  setAuth0TokenProvider(async () => "bob");
  fetcher.mockImplementation(async () => json({ balance: 30 }));
  expect(await api("/state")).toEqual({ balance: 30 });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls[3][1].headers.Authorization).toBe("Bearer bob");
});
it("respects Retry-After and never immediately retries a limited mutation", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ error: "limited" }, 429, { "retry-after": "2" }));
  vi.stubGlobal("fetch", fetcher);
  setAuth0TokenProvider(async () => "alice");
  await expect(api("/reports", {})).rejects.toMatchObject({
    status: 429,
    retryAfter: 2,
  });
  await expect(api("/reports", {})).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("simplifies service errors while retaining status and request references", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      json({ error: "Supabase connection error" }, 503, {
        "x-request-id": "safe-reference",
      }),
    ),
  );
  setAuth0TokenProvider(async () => "alice");
  await expect(api("/state")).rejects.toMatchObject({
    status: 503,
    requestId: "safe-reference",
    message: "Unable to load your information. Please try again.",
  });
});
it("retries only a failed read and classifies service failures safely", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetcher);
  setAuth0TokenProvider(async () => "alice");
  await expect(api("/state")).rejects.toMatchObject({ status: 503 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockClear();
  await expect(api("/purchases", {})).rejects.toMatchObject({ status: 503 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
