import { beforeEach, expect, it, vi } from "vitest";
import { initialUser, goalSaved } from "../server/ledger";
import { databaseState } from "../server/database-state";
import { readProfile, readWallets, readTransactions } from "../server/supabase";
import { userRead } from "../server/store";
vi.mock("../server/store", () => ({ userRead: vi.fn() }));
vi.mock("../server/supabase", () => ({
  readProfile: vi.fn(),
  readWallets: vi.fn(),
  readTransactions: vi.fn(),
  readSavingsRules: async () => [],
  getServerSupabase: () => ({
    rpc: async () => ({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ order: async () => ({ data: [], error: null }) }),
        }),
      }),
    }),
  }),
}));
beforeEach(() => {
  vi.mocked(userRead).mockResolvedValue(initialUser());
  vi.mocked(readProfile).mockResolvedValue({
    auth0_sub: "auth0|a",
    full_name: "A",
    email: null,
    email_verified: false,
    preferred_currency: "JOD",
    savings_enabled: true,
    currency_notifications: false,
    onboarding_completed_at: "2026-10-26",
    wallet_preferences: {},
  });
  vi.mocked(readWallets).mockResolvedValue([
    { currency: "JOD", available_minor: 1000, savings_minor: 0 },
  ]);
});
it("keeps chronological history and positive refund savings magnitude for goal reversal", async () => {
  const make = (kind: "purchase" | "refund", sign: number, date: string) => ({
    id: kind,
    kind,
    description: kind,
    category: "Other",
    occurred_at: date,
    metadata: { goalId: "goal" },
    ledger_entries: [
      {
        currency: "JOD" as const,
        account: "available" as const,
        amount_minor: -1250 * sign,
      },
      {
        currency: "JOD" as const,
        account: "external" as const,
        amount_minor: 1001 * sign,
      },
      {
        currency: "JOD" as const,
        account: "savings" as const,
        amount_minor: 249 * sign,
      },
    ],
  });
  vi.mocked(readTransactions).mockResolvedValue([
    make("refund", -1, "2026-10-26T12:00:00Z"),
    make("purchase", 1, "2026-10-26T11:00:00Z"),
  ]);
  const { data } = await databaseState("auth0|a", "a");
  expect(data.ledger.map((e) => e.id)).toEqual(["purchase", "refund"]);
  expect(data.ledger.map((e) => e.saved)).toEqual([249, 249]);
  expect(data.ledger.every((e) => e.goalId === "goal")).toBe(true);
  expect(goalSaved(data, "goal")).toBe(0);
});
it("identifies conversion source by its debit rather than unordered joined ledger rows", async () => {
  vi.mocked(readTransactions).mockResolvedValue([
    {
      id: "convert",
      kind: "conversion",
      description: "Convert",
      category: "Conversion",
      occurred_at: "2026-10-26",
      metadata: { to: "JOD", received: 709 },
      ledger_entries: [
        { currency: "JOD", account: "available", amount_minor: 709 },
        { currency: "USD", account: "available", amount_minor: -100 },
        { currency: "USD", account: "external", amount_minor: 100 },
        { currency: "JOD", account: "external", amount_minor: -709 },
      ],
    },
  ]);
  const { data } = await databaseState("auth0|a", "a");
  expect(data.ledger[0]).toMatchObject({ currency: "USD", amount: 100 });
});
