import { initialUser } from "../shared/ledger";
import type { Profile } from "../server/supabase";
const profiles = vi.hoisted(() => new Map<string, Profile>());
vi.mock("../server/store", async (original) => {
  const m = await original<typeof import("../server/store")>();
  return {
    ...m,
    userRead: async (uid: string) =>
      m.update(
        `user_${uid}`,
        () => initialUser(),
        (v) => v,
      ),
    userUpdate: async (
      uid: string,
      fn: (v: ReturnType<typeof initialUser>) => unknown,
    ) => m.update(`user_${uid}`, () => initialUser(), fn),
  };
});
vi.mock("../server/supabase", async (original) => ({
  ...(await original<typeof import("../server/supabase")>()),
  supabaseEnabled: () => true,
  initializeProfile: async (sub: string) => {
    if (!profiles.has(sub))
      profiles.set(sub, {
        auth0_sub: sub,
        full_name: null,
        email: null,
        email_verified: false,
        preferred_currency: "ILS",
        savings_enabled: null,
        currency_notifications: false,
        onboarding_completed_at: null,
        wallet_preferences: {},
      });
    return profiles.get(sub);
  },
  readProfile: async (sub: string) => profiles.get(sub),
  completeProfile: async (i: {
    sub: string;
    name: string;
    email: string;
    emailVerified: boolean;
    preferred: "USD";
    savings: boolean;
    notifications: boolean;
  }) => {
    const p = profiles.get(i.sub)!;
    if (!p.onboarding_completed_at)
      Object.assign(p, {
        full_name: i.name,
        email: i.email,
        email_verified: i.emailVerified,
        preferred_currency: i.preferred,
        savings_enabled: i.savings,
        currency_notifications: i.notifications,
        onboarding_completed_at: new Date().toISOString(),
      });
    return p;
  },
  getServerSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ limit: async () => ({ data: [] }) }) }),
      }),
    }),
  }),
}));
vi.mock("../server/database-state", () => ({
  databaseState: async (sub: string, uid: string) => {
    const { userRead } = await import("../server/store");
    const data = await userRead(uid),
      p = profiles.get(sub)!;
    data.profile = {
      fullName: p.full_name || "",
      email: p.email || "",
      emailVerified: p.email_verified,
      completedAt: p.onboarding_completed_at || "",
    };
    Object.assign(data.preferences, {
      name: p.full_name,
      preferred: p.preferred_currency,
      savings: p.savings_enabled ? "enabled" : "disabled",
      notifications: p.currency_notifications,
    });
    return {
      data,
      walletBalances: { ILS: 0, USD: 0, JOD: 0 },
      savingsBalances: { ILS: 0, USD: 0, JOD: 0 },
    };
  },
}));
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
let localKeys: ReturnType<typeof createLocalJWKSet>;
vi.mock("jose", async (original) => ({
  ...(await original<typeof import("jose")>()),
  createRemoteJWKSet:
    () =>
    (...args: Parameters<typeof localKeys>) =>
      localKeys(...args),
}));
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: typeof import("../server/auth0").verifyWalletToken;
let server: Server;
let base: string;
const subject = `auth0|${randomUUID()}`;
beforeAll(async () => {
  vi.stubEnv("AUTH0_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
  vi.stubEnv("AUTH0_CLIENT_ID", "wallet-client");
  keys = await generateKeyPair("RS256");
  localKeys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }],
  });
  verify = (await import("../server/auth0")).verifyWalletToken;
  vi.stubEnv("DATABASE_PATH", "data/auth0-test.db");
  const { app } = await import("../server/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    sub: subject,
    azp: "wallet-client",
    iss: "https://example.auth0.com/",
    aud: "wallet-client",
    role: "authenticated",
    name: "Taylor Example",
    email: "same@example.com",
    email_verified: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(keys.privateKey);
}
it("creates stable isolated IDs from verified subjects", async () => {
  const first = await verify(await token());
  expect(first).toMatch(/^auth0_[a-f0-9]{64}$/);
  expect(await verify(await token())).toBe(first);
  expect(await verify(await token({ sub: "paypal|two" }))).not.toBe(first);
});
it("protects API reads and writes even when a demo cookie is present", async () => {
  for (const path of ["/api/state", "/api/preferences"]) {
    const response = await fetch(base + path, {
      method: path.endsWith("preferences") ? "PUT" : "GET",
      headers: { "X-WalletWise": "1", cookie: `ww_session=${"a".repeat(64)}` },
    });
    expect(response.status).toBe(401);
  }
  expect(
    (
      await fetch(base + "/api/state", {
        headers: { Authorization: "Bearer forged" },
      })
    ).status,
  ).toBe(401);
  const response = await fetch(base + "/api/state", {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("ONBOARDING_REQUIRED");
});
it("rejects expired, wrong audience, wrong issuer, wrong client and unsigned tokens", async () => {
  for (const values of [
    { exp: 1 },
    { aud: "wrong" },
    { aud: "https://walletwise.api" },
    { aud: ["wallet-client", "other"], azp: undefined },
    { iss: "https://evil.test/" },
    { azp: "other-client" },
    { sub: "" },
  ])
    await expect(verify(await token(values))).rejects.toThrow();
  await expect(verify("not.a.token")).rejects.toThrow();
});
it("returns strict 401 JSON for malformed, unsigned and expired tokens at the backend", async () => {
  for (const bearer of [
    "live-smoke-invalid",
    "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.",
    await token({ exp: 1 }),
  ]) {
    const response = await fetch(base + "/api/state", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toHaveProperty("error");
  }
});

const profile = {
  fullName: "Taylor Example",
  email: "same@example.com",
  preferred: "USD",
  savings: "enabled",
  notifications: true,
};
async function request(path: string, body?: unknown, sub = subject) {
  return fetch(base + path, {
    method: body ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${await token({ sub })}`,
      "X-WalletWise": "1",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("prefills from the verified identity without exposing wallet data", async () => {
  const response = await request("/api/onboarding");
  expect(await response.json()).toMatchObject({
    complete: false,
    fullName: "Taylor Example",
    email: "same@example.com",
    emailVerified: true,
    savings: "unseen",
  });
});
it("rejects invalid data and client-supplied ownership or verification flags", async () => {
  for (const change of [
    { fullName: " " },
    { email: "invalid" },
    { preferred: "EUR" },
    { savings: "unseen" },
    { sub: "other" },
    { emailVerified: true },
    { completedAt: "now" },
  ]) {
    expect(
      (await request("/api/onboarding", { ...profile, ...change })).status,
    ).toBe(400);
  }
  expect((await request("/api/state")).status).toBe(403);
});
it("does not complete onboarding when persistence fails", async () => {
  const failure = vi
    .spyOn(await import("../server/supabase"), "completeProfile")
    .mockRejectedValueOnce(new Error("Storage unavailable"));
  expect((await request("/api/onboarding", profile)).status).toBe(503);
  failure.mockRestore();
  expect((await request("/api/state")).status).toBe(403);
});
it("atomically completes once, survives retry, and keeps same-email identities separate", async () => {
  const responses = await Promise.all([
    request("/api/onboarding", profile),
    request("/api/onboarding", profile),
  ]);
  expect(responses.every((r) => r.status === 200)).toBe(true);
  const first = await responses[0].json();
  expect(first).toMatchObject({
    complete: true,
    emailVerified: true,
    preferred: "USD",
  });
  const state = await (await request("/api/state")).json();
  expect(state.preferences).toMatchObject({
    name: "Taylor Example",
    preferred: "USD",
    savings: "enabled",
    notifications: true,
  });
  expect(state.profile.completedAt).toBeTruthy();
  expect(
    await (
      await request("/api/onboarding", { ...profile, savings: "disabled" })
    ).json(),
  ).toEqual(first);
  expect(await (await request("/api/onboarding")).json()).toEqual(first);
  expect(
    (await request("/api/preferences", { savings: "unseen" })).status,
  ).toBe(400);
  const other = `paypal|${randomUUID()}`;
  expect((await request("/api/state", undefined, other)).status).toBe(403);
  expect(
    await (await request("/api/onboarding", undefined, other)).json(),
  ).toMatchObject({ complete: false, email: profile.email });
  expect(
    await (
      await request(
        "/api/onboarding",
        { ...profile, email: "changed@example.com" },
        other,
      )
    ).json(),
  ).toMatchObject({ complete: true, emailVerified: false });
  expect(await (await request("/api/onboarding")).json()).toEqual(first);
});

it("accepts a standard ID token without optional azp and reads verified profile claims", async () => {
  const { auth0UserInfo } = await import("../server/auth0");
  const idToken = await token({ azp: undefined });
  expect(await verify(idToken)).toBe(await verify(await token()));
  expect(await auth0UserInfo(idToken, subject)).toEqual({
    name: "Taylor Example",
    email: "same@example.com",
    emailVerified: true,
  });
  await expect(auth0UserInfo(idToken, "another-subject")).rejects.toThrow();
});
it("requires the authenticated role when Supabase is enabled", async () => {
  vi.stubEnv("SUPABASE_ENABLED", "true");
  try {
    await expect(verify(await token({ role: "anon" }))).rejects.toThrow();
    await expect(verify(await token())).resolves.toMatch(/^auth0_/);
  } finally {
    vi.stubEnv("SUPABASE_ENABLED", "false");
  }
});
it("publishes Auth0 configuration without a resource-server audience", async () => {
  const response = await fetch(base + "/api/config");
  expect((await response.json()).auth0).not.toHaveProperty("audience");
});
