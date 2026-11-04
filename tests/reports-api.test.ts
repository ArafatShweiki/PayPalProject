import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { UserData } from "../shared/types";
import { fundedUser } from "./fixtures/user";
import { purchase } from "../shared/ledger";
const fixture = vi.hoisted(() => ({
  accounts: new Map<string, UserData>(),
  rows: [] as Record<string, unknown>[],
  provider: vi.fn(),
  accept: vi.fn(),
  failStorage: false,
}));
vi.mock("../server/auth0", () => ({
  auth0Enabled: true,
  auth0Config: null,
  verifyWalletIdentity: async (token: string) => {
    if (token === "expired") throw new Error("expired");
    return { uid: token, sub: `auth0|${token}` };
  },
}));
vi.mock("../server/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/store")>()),
  registerUserIdentity: vi.fn(),
  userRead: async (uid: string) => structuredClone(fixture.accounts.get(uid)!),
  userUpdate: async (uid: string, fn: (data: UserData) => unknown) =>
    fn(fixture.accounts.get(uid)!),
}));
vi.mock("../server/database-state", () => ({
  databaseState: async (sub: string, uid: string) => {
    if (sub !== `auth0|${uid}`) throw new Error("wrong owner");
    return { data: structuredClone(fixture.accounts.get(uid)!) };
  },
}));
vi.mock("../server/gemini-reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/gemini-reports")>()),
  generateReportContent: (facts: unknown) => fixture.provider(facts),
}));
vi.mock("../server/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/supabase")>()),
  supabaseEnabled: () => true,
  initializeProfile: async () => ({}),
  readProfile: async () => ({ onboarding_completed_at: "2026-01-01" }),
  acceptSavingsRule: (...args: unknown[]) => fixture.accept(...args),
  getServerSupabase: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({
          data:
            fixture.rows.find(
              (r) =>
                Object.entries(filters).every(([k, v]) => r[k] === v) &&
                r.status !== "ai_unavailable",
            ) ?? null,
        }),
        upsert: async (row: Record<string, unknown>) => {
          if (fixture.failStorage) return { error: { code: "08006" } };
          fixture.rows.push(structuredClone(row));
          return { error: null };
        },
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve({
            data: table === "funding_orders" ? [] : fixture.rows,
            error: null,
          }).then(resolve),
      };
      return q;
    },
  }),
}));
let server: Server, base: string;
beforeAll(async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const { app } = await import("../server/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fixture.failStorage = false;
  fixture.accept.mockReset();
});
function account() {
  const id = randomUUID();
  const d = fundedUser();
  d.preferences.savings = "enabled";
  d.profile = {
    fullName: "Private name",
    email: "private@example.com",
    emailVerified: true,
    completedAt: "2026-01-01",
  };
  purchase(d, "ILS", 2340, "Private merchant", "Food & drink");
  fixture.accounts.set(id, d);
  return id;
}
function post(
  uid: string | undefined,
  path = "/reports",
  body: unknown = { frequency: "weekly" },
) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-walletwise": "1",
      ...(uid ? { Authorization: `Bearer ${uid}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
function provider() {
  fixture.provider
    .mockReset()
    .mockResolvedValue({
      summary: "Review your recorded spending and savings.",
      spendingInsights: [],
      savingsInsights: [],
      recommendations: [
        {
          id: "ILS",
          description: "Consider the historical savings adjustment.",
        },
      ],
      nextSteps: [],
    });
}
it("requires a verified identity and rejects expired sessions", async () => {
  expect((await post(undefined)).status).toBe(401);
  expect((await post("expired")).status).toBe(401);
});
it("generates from trusted records, persists and caches across users and invalidates source changes", async () => {
  provider();
  const a = account(),
    b = account();
  const first = await post(a);
  expect(first.status).toBe(200);
  const report = await first.json();
  expect(report).toMatchObject({
    source: "Gemini",
    status: "complete",
    summaries: [
      { spending: 2340, savings: 160 },
      { spending: 0 },
      { spending: 0 },
    ],
  });
  expect(fixture.rows.find((r) => r.id === report.id)).toMatchObject({
    auth0_sub: `auth0|${a}`,
    input_fingerprint: report.inputFingerprint,
  });
  const input = JSON.stringify(fixture.provider.mock.calls[0][0]);
  expect(input).not.toMatch(
    /Private merchant|private@example|Private name|auth0/,
  );
  expect((await (await post(a)).json()).id).toBe(report.id);
  expect(fixture.provider).toHaveBeenCalledTimes(1);
  expect((await (await post(b)).json()).id).not.toBe(report.id);
  expect(fixture.provider).toHaveBeenCalledTimes(2);
  purchase(fixture.accounts.get(a)!, "ILS", 1300, "Private", "Other");
  expect((await (await post(a)).json()).inputFingerprint).not.toBe(
    report.inputFingerprint,
  );
  expect(fixture.provider).toHaveBeenCalledTimes(3);
});
it("rejects arbitrary financial inputs, invalid dates and future periods", async () => {
  const a = account();
  for (const body of [
    { frequency: "weekly", spending: 100 },
    { frequency: "yearly" },
    { frequency: "monthly", date: "2026-02-30" },
    { frequency: "weekly", date: "2099-01-01" },
    { frequency: "weekly", timezone: "Invalid/Zone" },
  ])
    expect((await post(a, "/reports", body)).status).toBe(400);
});
it("keeps calculated totals on provider failure, does not cache failure and never marks it complete", async () => {
  provider();
  fixture.provider.mockRejectedValue(new Error("private provider error"));
  const a = account();
  for (let i = 0; i < 2; i++) {
    const r = await (await post(a)).json();
    expect(r).toMatchObject({
      source: "deterministic",
      status: "ai_unavailable",
      summaries: [{ spending: 2340 }, { spending: 0 }, { spending: 0 }],
    });
    expect(JSON.stringify(r)).not.toContain("private provider error");
  }
  expect(fixture.provider).toHaveBeenCalledTimes(2);
});
it("deduplicates concurrent generation for the same account and period", async () => {
  provider();
  fixture.provider.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return {
      summary: "Review your recorded spending.",
      spendingInsights: [],
      savingsInsights: [],
      recommendations: [],
      nextSteps: [],
    };
  });
  const a = account();
  const responses = await Promise.all([post(a), post(a)]);
  const reports = await Promise.all(responses.map((r) => r.json()));
  expect(reports[0].id).toBe(reports[1].id);
  expect(fixture.provider).toHaveBeenCalledTimes(1);
});
it("enforces per-user rate limits and does not run a second provider call", async () => {
  vi.stubEnv("RATE_LIMIT_AI", "1");
  provider();
  const a = account();
  expect((await post(a)).status).toBe(200);
  const second = await post(a);
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBeTruthy();
  expect(fixture.provider).toHaveBeenCalledTimes(1);
});
it("authorizes recommendation ownership and requires explicit acceptance", async () => {
  provider();
  const a = account(),
    b = account();
  await post(a);
  const rule = fixture.accounts.get(a)!.recommendations[0];
  expect(
    (await post(b, `/recommendations/${rule.id}`, { decision: "accepted" }))
      .status,
  ).not.toBe(200);
  expect(fixture.accept).not.toHaveBeenCalled();
  expect(
    (await post(a, `/recommendations/${rule.id}`, { decision: "dismissed" }))
      .status,
  ).toBe(200);
  expect(fixture.accept).not.toHaveBeenCalled();
  const c = account();
  await post(c);
  const accepted = fixture.accounts.get(c)!.recommendations[0];
  expect(
    (await post(c, `/recommendations/${accepted.id}`, { decision: "accepted" }))
      .status,
  ).toBe(200);
  expect(fixture.accept).toHaveBeenCalledWith(
    `auth0|${c}`,
    expect.objectContaining({ id: accepted.id }),
  );
});
it("does not return success when Supabase cannot save the report", async () => {
  provider();
  fixture.failStorage = true;
  expect((await post(account())).status).toBe(503);
});

it("reuses durable Supabase reports after the short application cache expires", async () => {
  vi.stubEnv("AI_CACHE_TTL_MS", "1");
  provider();
  const a = account();
  const first = await (await post(a)).json();
  await new Promise((r) => setTimeout(r, 5));
  const second = await (await post(a)).json();
  expect(second.id).toBe(first.id);
  expect(second.explanationCache.cached).toBe(true);
  expect(fixture.provider).toHaveBeenCalledTimes(1);
});
it("rejects malformed or unsupported model recommendations and keeps deterministic calculations", async () => {
  provider();
  fixture.provider.mockResolvedValue({
    summary: "Review your records.",
    spendingInsights: [],
    savingsInsights: [],
    recommendations: [{ id: "FORGED", description: "Change a rule." }],
    nextSteps: [],
  });
  const r = await (await post(account())).json();
  expect(r.status).toBe("ai_unavailable");
  expect(r.aiContent).toBeUndefined();
  expect(r.summaries[0].spending).toBe(2340);
});
