import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { initialUser } from "../shared/ledger";
import { buildReport } from "../shared/reports";
import { mapTransaction } from "../server/database-state";
import type { Goal } from "../shared/types";
import type { StoredTransaction } from "../server/supabase";
let db: PGlite;
const migration = "202610310001_savings_destinations.sql";
const legacy = "auth0|legacy-savings",
  legacyGoal = randomUUID();
async function scalar<T = unknown>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  return Object.values((await db.query(sql, args)).rows[0] as object)[0] as T;
}
async function post(
  sub: string,
  entries: unknown[],
  metadata = {},
  kind = "adjustment",
  key = randomUUID(),
) {
  return scalar<{ id: string }>(
    "select walletwise_apply_transaction($1,$2::uuid,$2::text,$3,'Fixture','Other',$4::jsonb,$5::jsonb)",
    [sub, key, kind, JSON.stringify(entries), JSON.stringify(metadata)],
  );
}
function entries(currency: string, saved: number) {
  return [
    { currency, account: "available", amount_minor: -100 - saved },
    { currency, account: "external", amount_minor: 100 },
    { currency, account: "savings", amount_minor: saved },
  ];
}
async function account(sub = `auth0|${randomUUID()}`) {
  await scalar("select walletwise_initialize_user($1)", [sub]);
  await db.query(
    "insert into account_state(user_id,auth0_sub,state) values($1,$1,$2::jsonb)",
    [sub, JSON.stringify(initialUser())],
  );
  await scalar(
    "select walletwise_complete_onboarding($1,'Fixture',null,false,'USD',true,false)",
    [sub],
  );
  for (const currency of ["ILS", "USD", "JOD"])
    await post(sub, [
      { currency, account: "available", amount_minor: 100000 },
      { currency, account: "external", amount_minor: -100000 },
    ]);
  return sub;
}
async function create(
  sub: string,
  currency = "USD",
  makeDefault = false,
  target = 10000,
  key = randomUUID(),
) {
  return scalar<Goal>(
    "select walletwise_create_savings_goal($1,$1,$2,$3,$4::jsonb,$5)",
    [
      sub,
      key,
      `${currency}:${makeDefault}:${target}`,
      JSON.stringify({ name: "Travel", currency, target }),
      makeDefault,
    ],
  );
}
async function buy(
  sub: string,
  currency = "USD",
  amount = 1235,
  key = randomUUID(),
  fingerprint: string = key,
) {
  return scalar<{
    id: string;
    metadata: { goalId?: string; savingsDestination?: string };
  }>("select walletwise_purchase($1,$2,$3,$4,$5,'Coffee','Other')", [
    sub,
    key,
    fingerprint,
    currency,
    amount,
  ]);
}
async function select(sub: string, currency: string, id: string | null) {
  return scalar("select walletwise_patch_preferences($1,$2::jsonb)", [
    sub,
    JSON.stringify({ goalIds: { [currency]: id } }),
  ]);
}
async function destinations(sub: string) {
  return (
    await db.query<{
      currency: string;
      goal_id: string | null;
      amount_minor: number;
    }>(
      "select currency,goal_id,amount_minor::integer from savings_destination_balances where auth0_sub=$1 order by currency,goal_id",
      [sub],
    )
  ).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;",
  );
  for (const file of readdirSync("supabase/migrations")
    .sort()
    .filter((f) => f < migration))
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await account(legacy);
  const state = initialUser();
  state.goals = [
    {
      id: legacyGoal,
      name: "Historical goal",
      currency: "USD",
      target: 10000,
      createdAt: new Date().toISOString(),
    },
  ];
  await db.query(
    "update account_state set state=$2::jsonb where auth0_sub=$1",
    [legacy, JSON.stringify(state)],
  );
  await post(legacy, entries("USD", 65), {}, "purchase");
  await post(legacy, entries("USD", 20), { goalId: legacyGoal }, "purchase");
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await db.exec("set role service_role");
}, 30000);
afterAll(async () => {
  await db.close();
});

it("preserves historical money and exposes unearmarked savings without replacement postings", async () => {
  expect(await destinations(legacy)).toEqual(
    expect.arrayContaining([
      { currency: "USD", goal_id: null, amount_minor: 65 },
      { currency: "USD", goal_id: legacyGoal, amount_minor: 20 },
    ]),
  );
  expect(
    await scalar(
      "select savings_minor::integer from wallets where auth0_sub=$1 and currency='USD'",
      [legacy],
    ),
  ).toBe(85);
  expect(
    await scalar(
      "select count(*)::integer from transactions where auth0_sub=$1",
      [legacy],
    ),
  ).toBe(5);
  expect(
    await scalar(
      "select count(*)::integer from savings_reconciliation_issues where auth0_sub=$1",
      [legacy],
    ),
  ).toBe(0);
});
it("starts each currency at zero and routes no-goal round-ups into General Savings", async () => {
  const sub = await account();
  expect((await destinations(sub)).map((b) => b.amount_minor)).toEqual([
    0, 0, 0,
  ]);
  for (const [currency, amount, saved] of [
    ["USD", 1235, 65],
    ["ILS", 2340, 160],
    ["JOD", 7350, 650],
  ] as const) {
    const tx = await buy(sub, currency, amount);
    expect(tx.metadata.savingsDestination).toBe(`general:${currency}`);
    expect(tx.metadata.goalId).toBeUndefined();
    expect(
      (await destinations(sub)).find(
        (b) => b.currency === currency && b.goal_id === null,
      )?.amount_minor,
    ).toBe(saved);
  }
});
it("creates optional defaults, replaces only that currency and clears back to General Savings without moving history", async () => {
  const sub = await account();
  const first = await create(sub, "USD", true),
    second = await create(sub, "USD"),
    ils = await create(sub, "ILS", true);
  expect((await buy(sub)).metadata.goalId).toBe(first.id);
  await select(sub, "USD", second.id);
  expect((await buy(sub)).metadata.goalId).toBe(second.id);
  expect((await buy(sub, "ILS", 2340)).metadata.goalId).toBe(ils.id);
  await select(sub, "USD", null);
  expect((await buy(sub)).metadata.savingsDestination).toBe("general:USD");
  expect(
    (await destinations(sub))
      .filter((b) => b.currency === "USD")
      .map((b) => b.amount_minor)
      .sort(),
  ).toEqual([65, 65, 65]);
  const defaults = await scalar<Record<string, string | null>>(
    "select wallet_preferences->'goalIds' from profiles where auth0_sub=$1",
    [sub],
  );
  expect(defaults).toEqual({ USD: null, ILS: ils.id });
});
it("default creation is idempotent and ordinary goal creation does not change a default", async () => {
  const sub = await account(),
    key = randomUUID();
  const goal = await create(sub, "USD", true, 10000, key);
  expect(await create(sub, "USD", true, 10000, key)).toEqual(goal);
  await create(sub, "USD", false);
  expect((await buy(sub)).metadata.goalId).toBe(goal.id);
  expect(
    await scalar(
      "select count(*)::integer from savings_goals where auth0_sub=$1",
      [sub],
    ),
  ).toBe(2);
  await expect(create(sub, "ILS", true, 10000, key)).rejects.toThrow(
    /Idempotency/,
  );
});
it("completed and archived goals retain balances and future allocations return to General Savings", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true, 65);
  expect((await buy(sub)).metadata.goalId).toBe(goal.id);
  expect((await buy(sub)).metadata.savingsDestination).toBe("general:USD");
  await expect(select(sub, "USD", goal.id)).rejects.toThrow(/eligible/);
  const next = await create(sub, "USD", true);
  await buy(sub);
  await scalar("select walletwise_archive_savings_goal($1,$1,$2)", [
    sub,
    next.id,
  ]);
  expect((await buy(sub)).metadata.savingsDestination).toBe("general:USD");
  expect(
    (await destinations(sub))
      .filter((b) => b.goal_id !== null)
      .map((b) => b.amount_minor),
  ).toEqual([65, 65]);
  const stored = await scalar<Goal[]>(
    "select state->'goals' from account_state where auth0_sub=$1",
    [sub],
  );
  expect(stored.find((g) => g.id === next.id)?.archived).toBe(true);
});
it("enforces caps, per-currency rule opt-out and all-or-nothing insufficient funds", async () => {
  const sub = await account();
  await scalar("select walletwise_patch_preferences($1,$2::jsonb)", [
    sub,
    JSON.stringify({ caps: { USD: 10 } }),
  ]);
  await buy(sub);
  expect(
    (await destinations(sub)).find((b) => b.currency === "USD")?.amount_minor,
  ).toBe(10);
  const before = await scalar(
    "select available_minor::integer from wallets where auth0_sub=$1 and currency='USD'",
    [sub],
  );
  await expect(buy(sub, "USD", Number(before))).rejects.toThrow(/Insufficient/);
  expect(
    await scalar(
      "select available_minor::integer from wallets where auth0_sub=$1 and currency='USD'",
      [sub],
    ),
  ).toBe(before);
  await db.exec("reset role");
  await db.query(
    "update savings_rules set enabled=false where auth0_sub=$1 and currency='JOD'",
    [sub],
  );
  await db.exec("set role service_role");
  expect(
    (await buy(sub, "JOD", 7350)).metadata.savingsDestination,
  ).toBeUndefined();
  expect(
    (await destinations(sub)).find((b) => b.currency === "JOD")?.amount_minor,
  ).toBe(0);
});
it("deduplicates simultaneous requests and serializes eligible purchases without negative wallets", async () => {
  const sub = await account(),
    key = randomUUID();
  const duplicates = await Promise.all(
    Array.from({ length: 8 }, () => buy(sub, "USD", 1235, key)),
  );
  expect(new Set(duplicates.map((t) => t.id)).size).toBe(1);
  await expect(buy(sub, "USD", 1235, key, "changed-input")).rejects.toThrow(
    /Idempotency/,
  );
  await Promise.all(Array.from({ length: 10 }, () => buy(sub)));
  expect(
    (await destinations(sub)).find((b) => b.currency === "USD")?.amount_minor,
  ).toBe(715);
  expect(
    await scalar(
      "select available_minor::integer from wallets where auth0_sub=$1 and currency='USD'",
      [sub],
    ),
  ).toBe(85700);
  expect(
    await scalar(
      "select count(*)::integer from savings_reconciliation_issues where auth0_sub=$1",
      [sub],
    ),
  ).toBe(0);
});
it("refunds the original destination once after defaults change, preserving totals", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true),
    tx = await buy(sub);
  await select(sub, "USD", null);
  await buy(sub);
  const postings = (
    await db.query<{ currency: string; account: string; amount_minor: number }>(
      "select currency,account,(-amount_minor)::integer as amount_minor from ledger_entries where transaction_id=$1",
      [tx.id],
    )
  ).rows;
  await post(sub, postings, { goalId: goal.id, originalId: tx.id }, "refund");
  await expect(
    post(sub, postings, { goalId: goal.id, originalId: tx.id }, "refund"),
  ).rejects.toThrow();
  expect((await destinations(sub)).filter((b) => b.currency === "USD")).toEqual(
    expect.arrayContaining([
      { currency: "USD", goal_id: goal.id, amount_minor: 0 },
      { currency: "USD", goal_id: null, amount_minor: 65 },
    ]),
  );
});
it("persists dashboard totals and supplies reports and AI with both General Savings and goals", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true);
  await buy(sub);
  await select(sub, "USD", null);
  await buy(sub);
  const dashboard = await scalar<{
    dashboard: {
      generalSavings: Record<string, string>;
      goalTotals: Record<string, string>;
    };
  }>("select walletwise_dashboard($1,$1,'UTC')", [sub]);
  expect(dashboard.dashboard.generalSavings.USD).toBe("65");
  expect(dashboard.dashboard.goalTotals[goal.id]).toBe("65");
  const rows = (
    await db.query<StoredTransaction>(
      "select t.*, (select jsonb_agg(jsonb_build_object('currency',l.currency,'account',l.account,'amount_minor',l.amount_minor::text)) from ledger_entries l where l.transaction_id=t.id) as ledger_entries from transactions t where auth0_sub=$1",
      [sub],
    )
  ).rows;
  const data = initialUser();
  data.ledger = rows.map(mapTransaction);
  data.goals = [goal];
  const { report } = buildReport(data, "monthly", Date.now() + 1000);
  expect(report.savingsBalances?.USD).toBe(130);
  expect(report.generalSavings?.USD).toBe(65);
  expect(report.goals[0].saved).toBe(65);
  expect(report.summaries.find((s) => s.currency === "USD")?.savings).toBe(130);
});
it("rejects cross-user and cross-currency defaults and isolates RLS projections", async () => {
  const alice = await account(),
    bob = await account(),
    goal = await create(alice, "USD", true);
  await expect(select(bob, "USD", goal.id)).rejects.toThrow(/eligible/);
  await expect(select(alice, "ILS", goal.id)).rejects.toThrow(/eligible/);
  await expect(
    scalar("select walletwise_archive_savings_goal($1,$1,$2)", [bob, goal.id]),
  ).rejects.toThrow(/owned/);
  await buy(alice);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "authenticated", sub: bob }),
  ]);
  await db.exec("set role authenticated");
  expect(
    (
      await db.query<{ auth0_sub: string }>(
        "select distinct auth0_sub from savings_destination_balances",
      )
    ).rows,
  ).toEqual([{ auth0_sub: bob }]);
  await expect(
    scalar(
      "select walletwise_purchase($1,$2,'x','USD',1235,'Forbidden','Other')",
      [alice, randomUUID()],
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("delete from savings_destination_balances where goal_id is null"),
  ).rejects.toThrow();
  await db.exec("reset role;set role service_role");
});

it("finishes a goal once under simultaneous requests and never allocates past completion on later purchases", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true, 65);
  const posted = await Promise.all(Array.from({ length: 5 }, () => buy(sub)));
  expect(posted.filter((t) => t.metadata.goalId === goal.id)).toHaveLength(1);
  expect(
    (await destinations(sub)).find((b) => b.goal_id === goal.id)?.amount_minor,
  ).toBe(65);
  expect(
    (await destinations(sub)).find(
      (b) => b.currency === "USD" && b.goal_id === null,
    )?.amount_minor,
  ).toBe(260);
});
it("rejects competing purchases when funds cover only one and leaves no partial allocations", async () => {
  const sub = await account();
  const results = await Promise.allSettled([
    buy(sub, "USD", 99935),
    buy(sub, "USD", 99935),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await scalar(
      "select available_minor::integer from wallets where auth0_sub=$1 and currency='USD'",
      [sub],
    ),
  ).toBe(0);
  expect(
    (await destinations(sub)).find((b) => b.currency === "USD")?.amount_minor,
  ).toBe(65);
});
it("falls back from a deleted legacy default and reports its historical allocations for review", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true);
  await buy(sub);
  await db.exec("reset role");
  await db.query("delete from savings_goals where auth0_sub=$1 and id=$2", [
    sub,
    goal.id,
  ]);
  await db.exec("set role service_role");
  const before = await destinations(sub);
  expect((await buy(sub)).metadata.savingsDestination).toBe("general:USD");
  expect((await destinations(sub)).find((b) => b.goal_id === goal.id)).toEqual(
    before.find((b) => b.goal_id === goal.id),
  );
  expect(
    await scalar(
      "select wallet_preferences->'goalIds'->'USD' from profiles where auth0_sub=$1",
      [sub],
    ),
  ).toBeNull();
  expect(
    await scalar(
      "select count(*)::integer from savings_reconciliation_issues where auth0_sub=$1 and goal_id=$2",
      [sub, goal.id],
    ),
  ).toBeGreaterThan(0);
});
it("lazily imports valid legacy goals but leaves malformed history in the reconciliation queue", async () => {
  const sub = await account(),
    data = initialUser(),
    goal = randomUUID();
  data.goals = [
    {
      id: goal,
      name: "Legacy",
      currency: "JOD",
      target: 10000,
      createdAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      name: "Malformed date",
      currency: "USD",
      target: 1000,
      createdAt: "not-a-date",
    },
  ];
  await db.query(
    "update account_state set state=$2::jsonb,version=version+1 where auth0_sub=$1",
    [sub, JSON.stringify(data)],
  );
  await select(sub, "JOD", goal);
  expect((await buy(sub, "JOD", 7350)).metadata.goalId).toBe(goal);
  expect(
    await scalar(
      "select count(*)::integer from savings_reconciliation_issues where auth0_sub=$1 and issue='Auxiliary goal requires manual reconciliation'",
      [sub],
    ),
  ).toBe(1);
});
it("rolls back default cleanup if the purchase fails and keeps opt-out balances unchanged", async () => {
  const sub = await account(),
    goal = await create(sub, "USD", true, 65);
  await buy(sub);
  await db.exec("reset role");
  await db.query(
    "update profiles set wallet_preferences=jsonb_set(wallet_preferences,'{goalIds,USD}',to_jsonb($2::text)) where auth0_sub=$1",
    [sub, goal.id],
  );
  await db.exec("set role service_role");
  await expect(buy(sub, "USD", 9999999)).rejects.toThrow(/Insufficient/);
  expect(
    await scalar(
      "select wallet_preferences->'goalIds'->>'USD' from profiles where auth0_sub=$1",
      [sub],
    ),
  ).toBe(goal.id);
  await scalar("select walletwise_patch_preferences($1,$2::jsonb)", [
    sub,
    JSON.stringify({ savings: "disabled" }),
  ]);
  const before = await destinations(sub);
  await buy(sub, "USD", 1235);
  expect(await destinations(sub)).toEqual(before);
});
