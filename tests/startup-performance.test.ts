import { it, expect, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { initialUser } from "../shared/ledger";
const bench = vi.hoisted(() => ({
  calls: [] as string[],
  delay: 30,
  version: 0,
}));
vi.mock("../server/auth0", () => ({
  auth0Enabled: true,
  auth0Config: null,
  verifyWalletIdentity: async () => ({ uid: "perf", sub: "auth0|perf" }),
  auth0UserInfo: async () => ({
    name: "Test",
    email: "test@example.invalid",
    emailVerified: true,
  }),
}));
const profile = {
  auth0_sub: "auth0|perf",
  full_name: "Test",
  email: "test@example.invalid",
  email_verified: true,
  preferred_currency: "USD",
  savings_enabled: true,
  currency_notifications: true,
  onboarding_completed_at: "2026-01-01",
  wallet_preferences: {},
};
const transactions = Array.from({ length: 1501 }, () => ({
  id: randomUUID(),
  kind: "purchase",
  description: "Test",
  category: "Other",
  occurred_at: new Date().toISOString(),
  metadata: {},
  ledger_entries: [
    { currency: "USD", account: "available", amount_minor: -100 },
    { currency: "USD", account: "external", amount_minor: 100 },
  ],
}));
async function wait(label: string) {
  bench.calls.push(label);
  await new Promise((r) => setTimeout(r, bench.delay));
}
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (name: string) => {
      await wait(name);
      return { data: profile, error: null };
    },
    from: (table: string) => {
      let start = 0,
        end = 499,
        write = false;
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        order: () => query,
        limit: () => query,
        range: (a: number, b: number) => {
          start = a;
          end = b;
          return query;
        },
        update: () => {
          write = true;
          return query;
        },
        insert: () => {
          write = true;
          return query;
        },
        maybeSingle: async () => {
          await wait(table);
          return {
            data:
              table === "profiles"
                ? profile
                : {
                    auth0_sub: profile.auth0_sub,
                    version: bench.version,
                    state: initialUser(),
                  },
            error: null,
          };
        },
        then: (resolve: (value: unknown) => unknown) => {
          return (async () => {
            await wait(`${table}${write ? ":write" : ""}`);
            if (write) {
              bench.version++;
              return { data: [{ user_id: "perf" }], error: null };
            }
            return {
              data:
                table === "transactions"
                  ? transactions.slice(start, end + 1)
                  : table === "wallets"
                    ? ["USD", "ILS", "JOD"].map((currency) => ({
                        currency,
                        available_minor: 100000,
                        savings_minor: 0,
                      }))
                    : table === "savings_rules"
                      ? []
                      : [],
              error: null,
            };
          })().then(resolve);
        },
      };
      return query;
    },
  }),
}));
it("measures the actual authenticated startup critical path using controlled database latency", async () => {
  vi.stubEnv("PERFORMANCE_DIAGNOSTICS", "true");
  vi.stubEnv("AUTH0_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_ENABLED", "true");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  const { app } = await import("../server/app");
  let server: Server | undefined;
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const samples: number[] = [],
      counts: number[] = [];
    const headers: Record<string, string>[] = [];
    for (let run = 0; run < 3; run++) {
      bench.calls = [];
      const start = performance.now();
      for (const path of ["/bootstrap"]) {
        const response = await fetch(`${base}/api${path}`, {
          headers: { Authorization: "Bearer fixture" },
        });
        expect(response.status).toBe(200);
        await response.json();
        headers.push({
          "server-timing": response.headers.get("server-timing") || "",
        });
      }
      samples.push(Math.round(performance.now() - start));
      counts.push(bench.calls.length);
    }
    expect(counts).toEqual([3, 3, 3]);
    expect(bench.calls).not.toContain("walletwise_initialize_user");
    expect(bench.calls).not.toContain("account_state:write");
    const result = {
      mode: "after",
      databaseDelayMs: bench.delay,
      transactionCount: transactions.length,
      criticalRequests: 1,
      samplesMs: samples,
      medianMs: [...samples].sort((a, b) => a - b)[1],
      databaseOperations: counts,
      operations: bench.calls,
      serverTimings: headers,
    };
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      `test-results/startup-${result.mode}.json`,
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
  }
}, 15000);
