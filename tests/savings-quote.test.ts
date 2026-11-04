import { beforeEach, expect, it, vi } from "vitest";
import type { Snapshot } from "../shared/types";
const fixture = vi.hoisted(() => ({
  refresh: vi.fn(),
  snapshot: undefined as Snapshot | undefined,
  insert: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../server/rates", () => ({
  refreshRates: fixture.refresh,
  rateStaleMs: () => 60000,
}));
vi.mock("../server/store", () => ({
  snapshots: async () => (fixture.snapshot ? [fixture.snapshot] : []),
}));
vi.mock("../server/supabase", () => ({
  readProfile: vi.fn(),
  readSavingsRules: vi.fn(),
  readIdempotentTransaction: vi.fn(),
  getServerSupabase: () => ({
    rpc: fixture.rpc,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        fixture.insert(row);
        return {
          select: () => ({
            single: async () => ({
              data: { id: "test-quote", ...row },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));
import { issueSavingsQuote } from "../server/savings-circles";
beforeEach(() => {
  vi.clearAllMocks();
  fixture.refresh.mockResolvedValue(undefined);
  fixture.rpc.mockResolvedValue({
    data: { options: [{ kind: "goal", id: "goal", currency: "USD" }] },
    error: null,
  });
  fixture.snapshot = {
    id: "fresh",
    fetchedAt: new Date().toISOString(),
    publishedAt: null,
    source: "https://www.pma.ps/",
    ils: { ILS: 1000000, USD: 3500000, JOD: 5000000 },
    quotes: [],
  };
});
it("records a verified source quote and half-up target amount without leaking the account identity", async () => {
  const quote = await issueSavingsQuote("verified-user", "ILS", 400, {
    kind: "goal",
    id: "goal",
  });
  expect(quote).not.toHaveProperty("auth0_sub");
  expect(fixture.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      auth0_sub: "verified-user",
      source_minor: 400,
      target_minor: 114,
      target_currency: "USD",
      source: "https://www.pma.ps/",
      rate_units: 285714,
      snapshot_id: "fresh",
    }),
  );
});
it("same-currency quotes never request an external rate or change minor-unit amounts", async () => {
  const quote = await issueSavingsQuote("verified-user", "USD", 65, {
    kind: "goal",
    id: "goal",
  });
  expect(quote.target_minor).toBe(65);
  expect(fixture.refresh).not.toHaveBeenCalled();
});
it("stale or unavailable rates cannot create a financial quote", async () => {
  fixture.snapshot!.fetchedAt = "2000-01-01T00:00:00Z";
  await expect(
    issueSavingsQuote("verified-user", "ILS", 400, {
      kind: "goal",
      id: "goal",
    }),
  ).rejects.toThrow(/fresh/);
  expect(fixture.insert).not.toHaveBeenCalled();
  fixture.refresh.mockRejectedValue(new Error("Rate provider offline"));
  await expect(
    issueSavingsQuote("verified-user", "ILS", 400, {
      kind: "goal",
      id: "goal",
    }),
  ).rejects.toThrow(/offline/);
  expect(fixture.insert).not.toHaveBeenCalled();
});
it("quotes reject inaccessible destinations and amounts that round to zero", async () => {
  await expect(
    issueSavingsQuote("verified-user", "ILS", 400, {
      kind: "goal",
      id: "someone-else",
    }),
  ).rejects.toThrow(/eligible/);
  await expect(
    issueSavingsQuote("verified-user", "JOD", 1, { kind: "goal", id: "goal" }),
  ).rejects.toThrow(/too small/);
  expect(fixture.insert).not.toHaveBeenCalled();
});
