import { afterAll, beforeAll, expect, it, vi } from "vitest";
const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => query }));
let read: typeof import("../server/supabase").readTransactions;
beforeAll(async () => {
  vi.stubEnv("AUTH0_ENABLED", "true");
  vi.stubEnv("SUPABASE_ENABLED", "true");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  for (const name of ["from", "select", "eq", "in", "order"] as const)
    query[name].mockReturnValue(query);
  read = (await import("../server/supabase")).readTransactions;
});
afterAll(() => vi.unstubAllEnvs());
it("loads history beyond 500 transactions with stable ordering and subject filtering", async () => {
  query.range
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, id) => ({ id })),
      error: null,
    })
    .mockResolvedValueOnce({ data: [{ id: 500 }], error: null });
  expect(await read("paypal|subject")).toHaveLength(501);
  expect(query.range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
  ]);
  expect(query.eq).toHaveBeenCalledWith("auth0_sub", "paypal|subject");
  expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
});
