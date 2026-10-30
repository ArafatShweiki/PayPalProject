import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auth0IdTokenProvider,
  configureSupabase,
  getBrowserSupabase,
  setSupabaseIdTokenProvider,
} from "../src/supabase";

describe("Auth0 to Supabase third-party token integration", () => {
  it("passes the Auth0 raw ID token (not an access token) to Supabase", async () => {
    const provider = auth0IdTokenProvider(async () => ({
      __raw: "signed-id-token",
      role: "authenticated",
    }));
    await expect(provider()).resolves.toBe("signed-id-token");
  });

  it("rejects when Auth0 has no ID token to provide", async () => {
    const provider = auth0IdTokenProvider(async () => undefined);
    await expect(provider()).rejects.toThrow("Auth0 ID token is not available");
  });
});

it("rejects an ID token missing the required role", async () => {
  await expect(
    auth0IdTokenProvider(async () => ({ __raw: "token" }))(),
  ).rejects.toThrow('role: "authenticated"');
});

afterEach(() => {
  configureSupabase(null);
  setSupabaseIdTokenProvider();
  vi.unstubAllGlobals();
});
it("sends the current Auth0 ID token via the official SDK and clears it on logout", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response("[]", { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  configureSupabase({
    url: "https://example.supabase.co",
    publishableKey: "public-key",
  });
  let token = "first-id-token";
  setSupabaseIdTokenProvider(async () => token);
  const client = getBrowserSupabase()!;
  await client.from("profiles").select("auth0_sub");
  token = "renewed-id-token";
  await client.from("profiles").select("auth0_sub");
  const calls = fetcher.mock.calls as unknown as Array<
    [RequestInfo, RequestInit]
  >;
  expect(new Headers(calls[0][1].headers).get("Authorization")).toBe(
    "Bearer first-id-token",
  );
  expect(new Headers(calls[1][1].headers).get("Authorization")).toBe(
    "Bearer renewed-id-token",
  );
  expect(new Headers(calls[0][1].headers).get("apikey")).toBe("public-key");
  setSupabaseIdTokenProvider();
  const result = await client.from("profiles").select("auth0_sub").retry(false);
  expect(result.error?.message).toContain("Auth0 ID token is not available");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
