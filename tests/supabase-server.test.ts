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
import { initialUser } from "../shared/ledger";
import { userUpdate } from "../server/store";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
const db = vi.hoisted(() => ({
  initialize: vi.fn(),
  complete: vi.fn(),
  apply: vi.fn(),
  rpc: vi.fn(),
  patch: vi.fn(),
  accept: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("../server/auth0", () => ({
  auth0Enabled: true,
  auth0Config: {
    domain: "example.auth0.com",
    clientId: "client",
  },
  verifyWalletIdentity: async (token: string) => {
    if (token !== "verified-id-token") throw new Error("Invalid token");
    return { uid: "auth0_test", sub: "paypal|opaque-subject" };
  },
  auth0UserInfo: async () => ({
    name: "User",
    email: "user@example.com",
    emailVerified: true,
  }),
}));
vi.mock("../server/supabase", async (original) => ({
  ...(await original<typeof import("../server/supabase")>()),
  getServerSupabase: () => ({
    rpc: db.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  }),
  supabaseEnabled: () => true,
  initializeProfile: db.initialize,
  readProfile: db.profile,
  completeProfile: db.complete,
  applyLedgerTransaction: db.apply,
  updateProfilePreferences: db.patch,
  acceptSavingsRule: db.accept,
  readSavingsRules: async () => [
    { currency: "JOD", enabled: true, increment_minor: 250, cap_minor: 500 },
  ],
}));
let server: Server;
let base: string;
const profile = {
  auth0_sub: "paypal|opaque-subject",
  full_name: "User",
  email: "user@example.com",
  email_verified: true,
  preferred_currency: "JOD",
  savings_enabled: true,
  currency_notifications: false,
  onboarding_completed_at: "2026-10-26T00:00:00Z",
  wallet_preferences: { frequency: "weekly" },
};
beforeAll(async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  const { app } = await import("../server/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  vi.clearAllMocks();
  db.profile.mockResolvedValue(profile);
  db.complete.mockResolvedValue(profile);
  db.patch.mockResolvedValue(profile);
  db.apply.mockResolvedValue({ id: "transaction" });
  db.rpc.mockResolvedValue({ data: { id: "transaction" }, error: null });
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
async function request(
  path: string,
  body: unknown,
  method = "POST",
  token = "verified-id-token",
) {
  return fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-WalletWise": "1",
    },
    body: JSON.stringify(body),
  });
}
it("initializes only a verified subject and preserves onboarding identity checks", async () => {
  const body = {
    fullName: "User",
    email: "changed@example.com",
    preferred: "JOD",
    savings: "enabled",
    notifications: false,
  };
  expect((await request("/api/onboarding", body, "PUT", "forged")).status).toBe(
    401,
  );
  expect(db.initialize).not.toHaveBeenCalled();
  expect((await request("/api/onboarding", body, "PUT")).status).toBe(200);
  expect(db.initialize).not.toHaveBeenCalled();
  expect(db.complete).toHaveBeenCalledWith(
    expect.objectContaining({
      sub: "paypal|opaque-subject",
      emailVerified: false,
    }),
  );
  expect(
    (await request("/api/onboarding", { ...body, sub: "victim" }, "PUT"))
      .status,
  ).toBe(400);
});
it("delegates exact JOD minor units to the atomic purchase function without client ownership or destination", async () => {
  const response = await request("/api/purchases", {
    requestId: "00000000-0000-4000-8000-000000000001",
    currency: "JOD",
    amount: "1.001",
    description: "Lunch",
    category: "Food & drink",
    sub: "victim",
  });
  expect(response.status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith(
    "walletwise_goal_purchase",
    expect.objectContaining({
      p_sub: "paypal|opaque-subject",
      p_currency: "JOD",
      p_amount: 1001,
    }),
  );
  expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("goalId");
  expect(db.rpc.mock.calls[0][1]).not.toHaveProperty("saved");
});
it("persists wallet preference patches without accepting client ownership", async () => {
  const response = await request(
    "/api/preferences",
    { frequency: "weekly", increments: { ILS: 100, USD: 100, JOD: 250 } },
    "PUT",
  );
  expect(response.status).toBe(200);
  expect(db.patch).toHaveBeenCalledWith("paypal|opaque-subject", {
    frequency: "weekly",
    increments: { ILS: 100, USD: 100, JOD: 250 },
  });
});
it("sets or clears only the requested currency default using the verified subject", async () => {
  const goalId = "00000000-0000-4000-8000-000000000123";
  expect(
    (
      await request(
        "/api/savings/default",
        { currency: "USD", goalId, sub: "victim" },
        "PUT",
      )
    ).status,
  ).toBe(200);
  expect(db.rpc).toHaveBeenLastCalledWith(
    "walletwise_set_savings_destination",
    {
      p_sub: "paypal|opaque-subject",
      p_kind: "goal",
      p_id: goalId,
      p_enable: true,
    },
  );
  expect(
    (
      await request(
        "/api/savings/default",
        { currency: "USD", goalId: null },
        "PUT",
      )
    ).status,
  ).toBe(200);
  expect(db.patch).toHaveBeenLastCalledWith("paypal|opaque-subject", {
    savings: "disabled",
  });
});
it("creates a non-default goal unless explicitly requested and sends exact minor units to the atomic goal operation", async () => {
  const requestId = "00000000-0000-4000-8000-000000000124";
  expect(
    (
      await request("/api/goals", {
        requestId,
        name: "Trip",
        currency: "JOD",
        amount: "10.001",
      })
    ).status,
  ).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith(
    "walletwise_create_savings_goal",
    expect.objectContaining({
      p_sub: "paypal|opaque-subject",
      p_uid: "auth0_test",
      p_default: false,
      p_goal: expect.objectContaining({ target: 10001, currency: "JOD" }),
    }),
  );
  expect(
    (
      await request("/api/goals", {
        requestId,
        name: "Trip",
        currency: "JOD",
        amount: "10.001",
        makeDefault: true,
      })
    ).status,
  ).toBe(200);
  expect(db.rpc).toHaveBeenLastCalledWith(
    "walletwise_create_savings_goal",
    expect.objectContaining({ p_default: true }),
  );
});
it("blocks financial writes before onboarding", async () => {
  db.profile.mockResolvedValue({ ...profile, onboarding_completed_at: null });
  expect((await request("/api/purchases", {})).status).toBe(403);
  expect(db.apply).not.toHaveBeenCalled();
});

it("reports database outages as retryable failures without forcing another login", async () => {
  db.profile.mockRejectedValueOnce(new Error("internal connection details"));
  const response = await request("/api/onboarding", {}, "PUT");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Wallet database is unavailable. Please try again.",
  });
});
it("preserves safe actionable database errors for monetary failures", async () => {
  db.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "P0001", message: "Insufficient wallet balance" },
  });
  const response = await request("/api/purchases", {
    requestId: "00000000-0000-4000-8000-000000000099",
    currency: "JOD",
    amount: "1.001",
    description: "Lunch",
    category: "Food & drink",
  });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Insufficient");
});

it("accepts a saved recommendation through the PostgreSQL compare-and-set operation", async () => {
  const rule = {
    id: "audit-rule",
    currency: "JOD" as const,
    current: 250,
    suggested: 500,
    additional: 100,
    status: "pending" as const,
    reportId: "report",
    cap: 500,
    ledgerRevision: "revision",
  };
  await userUpdate("auth0_test", (data) => {
    data.recommendations = [rule];
  });
  expect(
    (await request("/api/recommendations/audit-rule", { decision: "accepted" }))
      .status,
  ).toBe(200);
  expect(db.accept).toHaveBeenCalledWith("paypal|opaque-subject", rule);
  expect(
    (await request("/api/recommendations/audit-rule", { decision: "accepted" }))
      .status,
  ).toBe(200);
  expect(db.accept).toHaveBeenCalledTimes(1);
});
it("exposes only public configuration through the browser config endpoint", async () => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "audit-secret-sentinel");
  const response = await fetch(base + "/api/config");
  const text = await response.text();
  expect(text).not.toContain("audit-secret-sentinel");
  expect(text).not.toContain("SUPABASE_SECRET_KEY");
});
it("binds circle votes to the verified identity and strips forged voter identifiers", async () => {
  const circle = "00000000-0000-4000-8000-000000000201",
    proposalId = "00000000-0000-4000-8000-000000000202",
    requestId = "00000000-0000-4000-8000-000000000203";
  expect(
    (
      await request(`/api/circles/${circle}/actions`, {
        requestId,
        action: "vote",
        proposalId,
        decision: "Approve",
        memberId: "victim",
        sub: "victim",
      })
    ).status,
  ).toBe(200);
  expect(db.rpc).toHaveBeenLastCalledWith("walletwise_circle_command", {
    p_sub: "paypal|opaque-subject",
    p_action: "vote",
    p_id: circle,
    p_key: requestId,
    p_payload: { proposalId, decision: "Approve" },
  });
});
it("generates direct links while persisting only a hash and rejects anonymous joins", async () => {
  const circle = "00000000-0000-4000-8000-000000000204",
    requestId = "00000000-0000-4000-8000-000000000205";
  const response = await request(`/api/circles/${circle}/invite`, {
    requestId,
  });
  expect(response.status).toBe(200);
  const result = await response.json(),
    raw = new URL(result.url).pathname.split("/").at(-1)!;
  expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const payload = db.rpc.mock.calls.at(-1)![1].p_payload;
  expect(payload).toEqual({
    hash: createHash("sha256").update(raw).digest("hex"),
  });
  expect(JSON.stringify(payload)).not.toContain(raw);
  db.rpc.mockClear();
  expect(
    (
      await request(
        "/api/circles/join",
        { requestId, token: raw },
        "POST",
        "forged",
      )
    ).status,
  ).toBe(401);
  expect(db.rpc).not.toHaveBeenCalled();
});
it("provides a limited public invitation preview without granting membership", async () => {
  db.rpc.mockResolvedValueOnce({
    data: {
      name: "Family",
      currency: "USD",
      target: "10000",
      description: "Trip",
    },
    error: null,
  });
  const raw = "c".repeat(43),
    response = await fetch(`${base}/api/circles/invite/${raw}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    name: "Family",
    currency: "USD",
    target: "10000",
    description: "Trip",
  });
  expect(db.rpc).toHaveBeenCalledWith("walletwise_invitation_preview", {
    p_hash: createHash("sha256").update(raw).digest("hex"),
  });
});
it("returns an actionable deployment error when the goal purchase migration is absent", async () => {
  db.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "PGRST202", message: "private schema details" },
  });
  const response = await request("/api/purchases", {
    requestId: "00000000-0000-4000-8000-000000000206",
    currency: "ILS",
    amount: "16",
    description: "Coffee",
    category: "Food & drink",
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error:
      "Savings setup needs an application update. Please contact the app administrator.",
  });
});
