import { afterEach, expect, it, vi } from "vitest";
import { paypal } from "../server/paypal";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function credentials() {
  vi.stubEnv("PAYPAL_CLIENT_ID", "sandbox-public-id");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "private-secret");
}
it.each([
  "CURRENCY_NOT_SUPPORTED",
  "PAYEE_ACCOUNT_RESTRICTED",
  "PAYEE_ACCOUNT_NOT_VERIFIED",
])(
  "reports merchant restriction %s safely without provider text",
  async (issue) => {
    credentials();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: "backend-token" }))
        .mockResolvedValueOnce(
          Response.json(
            { details: [{ issue, description: "private merchant details" }] },
            { status: 422 },
          ),
        ),
    );
    await expect(
      paypal("/v2/checkout/orders", {}, "key"),
    ).rejects.toMatchObject({ status: 422 });
  },
);
it("uses backend client credentials and Sandbox Orders v2 with a stable request key", async () => {
  credentials();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "backend-token" }))
    .mockResolvedValueOnce(Response.json({ id: "ORDER", status: "CREATED" }));
  vi.stubGlobal("fetch", fetcher);
  await paypal(
    "/v2/checkout/orders",
    { intent: "CAPTURE" },
    "stable-request-key",
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api-m.sandbox.paypal.com/v1/oauth2/token",
  );
  const [url, request] = fetcher.mock.calls[1];
  expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
  expect(request.headers["PayPal-Request-Id"]).toBe("stable-request-key");
  expect(request.headers.Authorization).toBe("Bearer backend-token");
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(request)).not.toContain("private-secret");
});
it("bounds network requests and reports timeouts without leaking credentials", async () => {
  credentials();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new DOMException("private upstream details", "TimeoutError"),
      ),
  );
  await expect(paypal("/v2/checkout/orders", {}, "key")).rejects.toMatchObject({
    status: 503,
  });
  expect(JSON.stringify(warning.mock.calls)).not.toMatch(
    /private-secret|private upstream details|sandbox-public-id/,
  );
});
it("does not call Orders when merchant OAuth credentials are rejected", async () => {
  credentials();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ error: "invalid_client" }, { status: 401 }),
    );
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await expect(paypal("/v2/checkout/orders", {}, "key")).rejects.toMatchObject({
    status: 503,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
