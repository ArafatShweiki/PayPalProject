import { userUpdate } from "../server/store";
import { DatabaseError } from "../server/database-errors";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
const db = vi.hoisted(() => ({
  initialize: vi.fn(),
  complete: vi.fn(),
  apply: vi.fn(),
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
  expect(db.initialize).toHaveBeenCalledWith("paypal|opaque-subject");
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
it("computes JOD postings on the backend using persisted savings rules", async () => {
  const response = await request("/api/purchases", {
    requestId: "00000000-0000-4000-8000-000000000001",
    currency: "JOD",
    amount: "1.001",
    description: "Lunch",
    category: "Food & drink",
    sub: "victim",
  });
  expect(response.status).toBe(200);
  expect(db.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      sub: "paypal|opaque-subject",
      entries: [
        { currency: "JOD", account: "available", amount_minor: -1250 },
        { currency: "JOD", account: "external", amount_minor: 1001 },
        { currency: "JOD", account: "savings", amount_minor: 249 },
      ],
    }),
  );
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
it("blocks financial writes before onboarding", async () => {
  db.profile.mockResolvedValue({ ...profile, onboarding_completed_at: null });
  expect((await request("/api/purchases", {})).status).toBe(403);
  expect(db.apply).not.toHaveBeenCalled();
});

it("reports database outages as retryable failures without forcing another login", async () => {
  db.initialize.mockRejectedValueOnce(new Error("internal connection details"));
  const response = await request("/api/onboarding", {}, "PUT");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Wallet database is unavailable. Please try again.",
  });
});
it("preserves safe actionable database errors for monetary failures", async () => {
  db.apply.mockRejectedValueOnce(
    new DatabaseError("Insufficient wallet balance for this operation.", 409),
  );
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
