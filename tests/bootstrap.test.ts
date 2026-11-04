import { beforeEach, it, expect, vi } from "vitest";
import type { Profile } from "../server/supabase";
const db = vi.hoisted(() => ({
  wallets: vi.fn(),
  rules: vi.fn(),
  initialize: vi.fn(),
}));
vi.mock("../server/supabase", () => ({
  readWallets: db.wallets,
  readSavingsRules: db.rules,
  initializeProfile: db.initialize,
}));
vi.mock("../server/funding", () => ({ fundingEnabled: () => false }));
vi.mock("../server/rates", () => ({ rateStaleMs: () => 30000 }));
import { bootstrap } from "../server/bootstrap";
const profile: Profile = {
  auth0_sub: "auth0|a",
  full_name: "Test",
  email: null,
  email_verified: false,
  preferred_currency: "USD",
  savings_enabled: false,
  currency_notifications: false,
  onboarding_completed_at: "2026-10-30",
  wallet_preferences: {},
};
const wallets = () =>
  ["USD", "ILS", "JOD"].map((currency) => ({
    currency,
    available_minor: currency === "USD" ? "12345" : "0",
    savings_minor: "0",
  }));
beforeEach(() => {
  vi.clearAllMocks();
  db.wallets.mockResolvedValue(wallets());
  db.rules.mockResolvedValue([]);
  db.initialize.mockResolvedValue(profile);
});
it("loads only essential balances, in parallel with savings rules, without reinitializing an existing wallet", async () => {
  let release!: (rows: ReturnType<typeof wallets>) => void;
  db.wallets.mockReturnValue(
    new Promise((r) => {
      release = r;
    }),
  );
  const pending = bootstrap(profile.auth0_sub, profile);
  expect(db.rules).toHaveBeenCalledOnce();
  expect(db.initialize).not.toHaveBeenCalled();
  release(wallets());
  const result = await pending;
  expect(result.state?.balances).toEqual({ USD: 12345, ILS: 0, JOD: 0 });
  expect(result.state?.ledger).toEqual([]);
  expect(result.state?.progressive).toBe(true);
});
it("returns an onboarding decision without loading or exposing financial data for a new user", async () => {
  const result = await bootstrap(profile.auth0_sub, {
    ...profile,
    onboarding_completed_at: null,
  });
  expect(result.onboarding.complete).toBe(false);
  expect(result.state).toBeUndefined();
  expect(db.wallets).not.toHaveBeenCalled();
  expect(db.rules).not.toHaveBeenCalled();
});
it("repairs missing wallet records once through the existing idempotent initializer", async () => {
  db.wallets
    .mockResolvedValueOnce(wallets().slice(0, 1))
    .mockResolvedValueOnce(wallets());
  const result = await bootstrap(profile.auth0_sub, profile);
  expect(db.initialize).toHaveBeenCalledOnce();
  expect(db.wallets).toHaveBeenCalledTimes(2);
  expect(result.state?.balances.USD).toBe(12345);
});
it("fails recoverably instead of displaying zeros if wallet records remain missing", async () => {
  db.wallets.mockResolvedValue(wallets().slice(0, 1));
  await expect(bootstrap(profile.auth0_sub, profile)).rejects.toMatchObject({
    status: 503,
  });
  expect(db.initialize).toHaveBeenCalledOnce();
});
it.each(["not-a-number", "1.5", "-1", "9007199254740992"])(
  "refuses an invalid balance %s",
  async (value) => {
    const rows = wallets();
    rows[0].available_minor = value;
    db.wallets.mockResolvedValue(rows);
    await expect(bootstrap(profile.auth0_sub, profile)).rejects.toMatchObject({
      status: 503,
    });
  },
);
