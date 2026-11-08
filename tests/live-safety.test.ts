import { afterEach, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  PRODUCTION_ORIGIN,
  assertRequest,
  previewTarget,
  SafetyError,
  safePath,
  type Target,
} from "./live/safety";
import { suspiciousPublicText, sanitizeTrace } from "./live/artifacts";
import { safeSend, production, publicConfig } from "./live/environment";
import SafeLiveReporter, { redactTitle, reportOutcome } from "./live/reporter";
import type { TestError } from "@playwright/test/reporter";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("recognizes the confirmed Vercel firewall response only for deliberate production token probes", async () => {
  const headers = {
    server: "Vercel",
    "x-vercel-id": "fra1::test-id",
    "content-type": "text/plain",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response("Forbidden\n\nForbidden\nfra1::test-id\n", {
          status: 403,
          headers,
        }),
      ),
    ),
  );
  for (const token of [
    "live-smoke-invalid",
    "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.",
  ]) {
    const result = await safeSend(production, "GET", "/api/state", token);
    expect(result.status).toBe(403);
    expect(result).toHaveProperty("rejectionLayer", "vercel-firewall");
    expect(result.body).toBeNull();
  }
});
it("does not accept generic, application, HTML, unrelated or Preview non-JSON rejections", async () => {
  const headers = {
    server: "Vercel",
    "x-vercel-id": "fra1::test-id",
    "content-type": "text/plain",
  };
  for (const change of [
    { headers: { ...headers, server: "Express" } },
    { headers: { ...headers, "x-vercel-id": "" } },
    { headers: { ...headers, "x-request-id": "app-id" } },
    { headers: { ...headers, "content-type": "text/html" } },
    { status: 500 },
    { text: "Unexpected failure" },
    { path: "/api/dashboard" },
    { token: undefined },
    {
      target: {
        mode: "preview-e2e" as const,
        origin: "https://isolated.vercel.app",
      },
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            "text" in change
              ? change.text
              : "Forbidden\n\nForbidden\nfra1::test-id\n",
            {
              status: change.status || 403,
              headers: change.headers || headers,
            },
          ),
        ),
      ),
    );
    await expect(
      safeSend(
        change.target ?? production,
        "GET",
        change.path || "/api/state",
        "token" in change ? change.token : "live-smoke-invalid",
      ),
    ).rejects.toThrow("non-JSON");
  }
});
it("never labels collection failures or an empty suite as a successful blocked run", () => {
  expect(reportOutcome([], "failed")).toBe("failed");
  expect(reportOutcome([true], "failed")).toBe("failed");
  expect(reportOutcome([true], "passed")).toBe("blocked");
  expect(reportOutcome([false], "passed")).toBe("passed");
});
it("redacts credentials, account identities, invitation tokens and query strings in report titles", () => {
  vi.stubEnv("LIVE_USER_A_PASSWORD", "private-test-password");
  const title = redactTitle(
    "private-test-password a@example.test Bearer abc123 https://preview.test/circles/invite/" +
      "x".repeat(43) +
      "?session=secret",
  );
  expect(title).not.toContain("private-test-password");
  expect(title).not.toContain("a@example.test");
  expect(title).not.toContain("abc123");
  expect(title).not.toContain("session=");
  expect(title).not.toContain("x".repeat(43));
});
it("keeps safe HTTP diagnosis but removes arbitrary private assertion errors and source context", () => {
  const reporter = new SafeLiveReporter();
  const privateError: TestError = {
    message: "Assertion expected wallet 12345 for a@example.test",
    stack: "private-source",
    snippet: "private-dom",
  };
  reporter.onError(privateError);
  expect(JSON.stringify(privateError)).not.toContain("12345");
  expect(privateError.stack).toBeUndefined();
  expect(privateError.snippet).toBeUndefined();
  const safe: TestError = {
    message:
      "Error: Live API returned a non-JSON response (HTTP 403); body withheld.",
  };
  reporter.onError(safe);
  expect(safe.message).toContain("HTTP 403");
});
it("blocks every Production mutation method before a request can be sent", async () => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  for (const method of [
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "TRACE",
    "post",
  ])
    await expect(
      safeSend(production, method, "/api/purchases", undefined, {}),
    ).rejects.toBeInstanceOf(SafetyError);
  expect(transport).not.toHaveBeenCalled();
});
it("rejects state-changing GETs, encoded paths, real credentials and production aliases", () => {
  for (const path of [
    "/api/cron",
    "/api/bootstrap",
    "/api/rates/live",
    "/api/rates/refresh",
    "/%61pi/cron",
    "/api%2fcron",
  ])
    expect(() =>
      assertRequest(production, "GET", PRODUCTION_ORIGIN + path),
    ).toThrow(SafetyError);
  expect(() =>
    assertRequest(
      production,
      "GET",
      PRODUCTION_ORIGIN + "/api/state",
      "Bearer real-credential",
    ),
  ).toThrow(SafetyError);
  expect(() =>
    previewTarget(
      PRODUCTION_ORIGIN.toUpperCase() + "/",
      "https://testprojectref0001.supabase.co",
      "https://prodprojectref0001.supabase.co",
      "testprojectref0001",
    ),
  ).toThrow();
  expect(() =>
    previewTarget(
      PRODUCTION_ORIGIN + "./",
      "https://testprojectref0001.supabase.co",
      "https://prodprojectref0001.supabase.co",
      "testprojectref0001",
    ),
  ).toThrow();
});
it("does not equate a Preview hostname with database isolation", () => {
  const prod = "https://prodprojectref0001.supabase.co";
  expect(() =>
    previewTarget(
      "https://isolated.vercel.app",
      prod,
      prod,
      "prodprojectref0001",
    ),
  ).toThrow();
  expect(() =>
    previewTarget(
      "https://isolated.vercel.app",
      "https://wrongprojectref0001.supabase.co",
      prod,
      "testprojectref0001",
    ),
  ).toThrow();
  const target = previewTarget(
    "https://isolated.vercel.app",
    "https://testprojectref0001.supabase.co",
    prod,
    "testprojectref0001",
  );
  expect(() =>
    assertRequest(target, "POST", target.origin + "/api/purchases"),
  ).toThrow();
  target.mutationReady = true;
  expect(() =>
    assertRequest(target, "POST", target.origin + "/api/purchases"),
  ).not.toThrow();
  expect(() =>
    assertRequest(target, "POST", PRODUCTION_ORIGIN + "/api/purchases"),
  ).toThrow();
  expect(() =>
    assertRequest(target, "POST", "https://www.paypal.com/checkout"),
  ).toThrow();
});
it("allows only the explicit Preview database and matching Auth0 redirect/client", () => {
  const target: Target = {
    mode: "preview-e2e",
    origin: "https://isolated.vercel.app",
    databaseOrigin: "https://testprojectref0001.supabase.co",
    auth0Origin: "https://example.auth0.com",
    auth0ClientId: "test-client",
    mutationReady: true,
  };
  expect(() =>
    assertRequest(target, "GET", target.databaseOrigin + "/rest/v1/wallets"),
  ).not.toThrow();
  expect(() =>
    assertRequest(target, "POST", target.databaseOrigin + "/rest/v1/wallets"),
  ).toThrow();
  expect(() =>
    assertRequest(
      target,
      "GET",
      target.auth0Origin +
        "/authorize?client_id=test-client&redirect_uri=" +
        encodeURIComponent(PRODUCTION_ORIGIN),
    ),
  ).toThrow();
  expect(() =>
    assertRequest(
      target,
      "POST",
      target.auth0Origin + "/dbconnections/change_password",
    ),
  ).toThrow();
});
it("distinguishes a library PEM parser marker from actual private-key material", () => {
  expect(
    suspiciousPublicText('const label="-----BEGIN PRIVATE KEY-----";'),
  ).toBe(false);
  expect(
    suspiciousPublicText("-----BEGIN PRIVATE KEY-----\n" + "A".repeat(80)),
  ).toBe(true);
  expect(
    suspiciousPublicText("public-code secret-value", ["secret-value"]),
  ).toBe(true);
});
it("strips tokens, body data, cookies, action arguments and resources from trace archives", () => {
  const secret = "private-password-and-token-123456";
  const raw = zipSync({
    "trace.trace": strToU8(
      [
        {
          type: "context-options",
          version: 8,
          browserName: "chromium",
          options: { storageState: secret },
        },
        {
          type: "before",
          callId: "one",
          apiName: "locator.fill",
          params: { value: secret },
        },
        {
          type: "after",
          callId: "one",
          result: secret,
          error: { message: secret },
        },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
    ),
    "trace.network": strToU8(
      JSON.stringify({
        type: "resource-snapshot",
        snapshot: {
          request: {
            method: "POST",
            url: "https://example.auth0.com/oauth/token?secret=" + secret,
            headers: [{ name: "Authorization", value: secret }],
            postData: { text: secret },
          },
          response: {
            status: 200,
            headers: [{ name: "Set-Cookie", value: secret }],
            content: { text: secret },
          },
        },
      }),
    ),
    "resources/payload": strToU8(secret),
  });
  const clean = unzipSync(sanitizeTrace(raw));
  expect(Object.keys(clean)).toEqual(["trace.trace", "trace.network"]);
  expect(
    Object.values(clean)
      .map((value) => strFromU8(value))
      .join(""),
  ).not.toContain(secret);
  expect(
    safePath(
      "https://example.test/circles/invite/" + "a".repeat(43) + "?token=secret",
    ),
  ).toBe("/circles/invite/[redacted]");
});
it("public configuration rejects extra fields and misplaced privileged keys without printing them", () => {
  const value = { marketProvider: "PMA", auth0: null, supabase: null };
  expect(() => publicConfig(value)).not.toThrow();
  expect(() => publicConfig({ ...value, secret: "private" })).toThrow(
    "allowed-field",
  );
  expect(() =>
    publicConfig({
      ...value,
      supabase: {
        url: "https://test.supabase.co",
        publishableKey: "sb_secret_" + "x".repeat(30),
      },
    }),
  ).toThrow("privileged");
});
