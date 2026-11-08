import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CircleLedgerFixture } from "./fixtures/circle-ledger";
const ledger = new CircleLedgerFixture();
beforeAll(() => ledger.initialize(), 60000);
afterAll(() => ledger.db.close());
it.each(["ILS", "USD", "JOD"])(
  "deletes a funded %s goal atomically, only once, and supports subsequent refunds",
  async (currency) => {
    const sub = await ledger.account(randomUUID());
    const g = await ledger.rpc<{ id: string }>(
      "walletwise_create_savings_goal",
      [
        sub,
        sub,
        randomUUID(),
        "goal",
        JSON.stringify({ name: "Delete me", currency, target: 10000 }),
        true,
      ],
    );
    const tx = await ledger.rpc<{ id: string }>(
      "walletwise_apply_transaction",
      [
        sub,
        randomUUID(),
        "purchase",
        "purchase",
        "Coffee",
        "Food",
        JSON.stringify([
          { currency, account: "available", amount_minor: -150 },
          { currency, account: "external", amount_minor: 100 },
          { currency, account: "savings", amount_minor: 50 },
        ]),
        JSON.stringify({ goalId: g.id }),
      ],
    );
    const before = await ledger.read(sub);
    await expect(
      ledger.rpc("walletwise_delete_savings_goal", ["other", "other", g.id]),
    ).rejects.toThrow();
    const result = await ledger.rpc("walletwise_delete_savings_goal", [
      sub,
      sub,
      g.id,
    ]);
    expect(result).toMatchObject({
      deleted: true,
      currency,
      returnedMinor: "50",
    });
    const after = await ledger.read(sub);
    for (const c of ["ILS", "USD", "JOD"] as const) {
      expect(after.balances[c]).toBe(
        before.balances[c] + (c === currency ? 50 : 0),
      );
      expect(after.savingsBalances[c]).toBe(
        before.savingsBalances[c] - (c === currency ? 50 : 0),
      );
    }
    expect(after.goals.some((x) => x.id === g.id)).toBe(false);
    expect(after.preferences.savings).toBe("disabled");
    await ledger.rpc("walletwise_delete_savings_goal", [sub, sub, g.id]);
    expect((await ledger.read(sub)).balances).toEqual(after.balances);
    await ledger.rpc("walletwise_goal_refund", [sub, randomUUID(), tx.id]);
    const refunded = await ledger.read(sub);
    expect(refunded.balances).toEqual({
      ILS: 100000,
      USD: 100000,
      JOD: 100000,
    });
    expect(refunded.savingsBalances).toEqual({ ILS: 0, USD: 0, JOD: 0 });
    expect(
      (
        await ledger.db.query(
          "select transaction_id from ledger_entries group by transaction_id,currency having sum(amount_minor)<>0",
        )
      ).rows,
    ).toEqual([]);
  },
);
it("deletes empty goals without a financial entry and preserves another default", async () => {
  const sub = await ledger.account(randomUUID());
  const create = () =>
    ledger.rpc<{ id: string }>("walletwise_create_savings_goal", [
      sub,
      sub,
      randomUUID(),
      "goal",
      JSON.stringify({ name: "Empty", currency: "USD", target: 10000 }),
      true,
    ]);
  const first = await create(),
    second = await create();
  const before = await ledger.read(sub);
  await ledger.rpc("walletwise_delete_savings_goal", [sub, sub, first.id]);
  const after = await ledger.read(sub);
  expect(after.ledger).toHaveLength(before.ledger.length);
  expect(after.preferences.savingsDestination?.id).toBe(second.id);
});

it("returns converted savings in the goal currency and refunds only the original merchant amount", async () => {
  const sub = await ledger.account(randomUUID());
  const g = await ledger.rpc<{ id: string }>("walletwise_create_savings_goal", [
    sub,
    sub,
    randomUUID(),
    "goal",
    JSON.stringify({ name: "USD goal", currency: "USD", target: 10000 }),
    true,
  ]);
  const quote = await ledger.quote(sub, "ILS", 400, { kind: "goal", id: g.id });
  const tx = await ledger.rpc<{ id: string }>("walletwise_goal_purchase", [
    sub,
    randomUUID(),
    "purchase",
    "ILS",
    1600,
    "Coffee",
    "Food",
    quote.id,
    false,
  ]);
  const before = await ledger.read(sub);
  expect(before.savingsBalances.USD).toBe(114);
  await ledger.rpc("walletwise_delete_savings_goal", [sub, sub, g.id]);
  const after = await ledger.read(sub);
  expect(after.balances.ILS).toBe(before.balances.ILS);
  expect(after.balances.USD).toBe(before.balances.USD + 114);
  await ledger.rpc("walletwise_goal_refund", [sub, randomUUID(), tx.id]);
  const refunded = await ledger.read(sub);
  expect(refunded.balances.ILS).toBe(99600);
  expect(refunded.balances.USD).toBe(100114);
  expect(refunded.savingsBalances.USD).toBe(0);
});
it("rolls back the return transfer if removing the goal fails", async () => {
  const sub = await ledger.account(randomUUID());
  const g = await ledger.rpc<{ id: string }>("walletwise_create_savings_goal", [
    sub,
    sub,
    randomUUID(),
    "goal",
    JSON.stringify({ name: "Rollback", currency: "USD", target: 10000 }),
    true,
  ]);
  await ledger.rpc("walletwise_apply_transaction", [
    sub,
    randomUUID(),
    "save",
    "adjustment",
    "Save",
    "Savings",
    JSON.stringify([
      { currency: "USD", account: "available", amount_minor: -50 },
      { currency: "USD", account: "savings", amount_minor: 50 },
    ]),
    JSON.stringify({ goalId: g.id }),
  ]);
  const before = await ledger.read(sub);
  await ledger.db.exec(
    "reset role; create function public.test_fail_goal_delete() returns trigger language plpgsql as $$begin raise exception 'Injected failure'; end$$; create trigger test_fail_goal_delete before update of deleted_at on savings_goals for each row execute function public.test_fail_goal_delete(); set role service_role;",
  );
  try {
    await expect(
      ledger.rpc("walletwise_delete_savings_goal", [sub, sub, g.id]),
    ).rejects.toThrow("Injected failure");
    const after = await ledger.read(sub);
    expect(after.balances).toEqual(before.balances);
    expect(after.savingsBalances).toEqual(before.savingsBalances);
    expect(after.goals).toEqual(before.goals);
    expect(after.ledger).toEqual(before.ledger);
  } finally {
    await ledger.db.exec(
      "reset role; drop trigger test_fail_goal_delete on savings_goals; drop function public.test_fail_goal_delete(); set role service_role;",
    );
  }
});
