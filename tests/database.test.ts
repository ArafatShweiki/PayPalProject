import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";

let db: PGlite;
const alice = "auth0|alice";
const bob = "paypal|bob";
const tables = [
  "profiles",
  "wallets",
  "transactions",
  "ledger_entries",
  "savings_rules",
  "savings_goals",
  "savings_allocations",
  "currency_alerts",
  "notifications",
  "ai_reports",
];
async function rows(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows;
}
async function initialize(sub: string) {
  await db.query("select walletwise_initialize_user($1)", [sub]);
}
async function post(
  key: string,
  entries: unknown,
  kind = "adjustment",
  metadata = {},
  fingerprint = key,
) {
  return db.query(
    "select walletwise_apply_transaction($1,$2,$3,$4,'Test fixture','Other',$5::jsonb,$6::jsonb)",
    [
      alice,
      key,
      fingerprint,
      kind,
      JSON.stringify(entries),
      JSON.stringify(metadata),
    ],
  );
}
const entry = (amount: number, currency = "JOD") => [
  { currency, account: "available", amount_minor: amount },
  { currency, account: "external", amount_minor: -amount },
];
const key = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as
    $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;`);
  for (const file of readdirSync("supabase/migrations").sort()) {
    // Core PostgreSQL provides gen_random_uuid(); only the optional extension is omitted.
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  }
  await db.exec("set role service_role");
  await initialize(alice);
  await initialize(bob);
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("initializes opaque subjects idempotently with three zero wallets", async () => {
  await initialize(alice);
  expect(
    await rows(
      "select currency,available_minor::text,savings_minor::text from wallets where auth0_sub=$1 order by currency",
      [alice],
    ),
  ).toEqual(
    ["ILS", "JOD", "USD"].map((currency) => ({
      currency,
      available_minor: "0",
      savings_minor: "0",
    })),
  );
});
it("commits JOD minor units, replays once, rejects changed keys and rolls back insufficient funds", async () => {
  await post(key(1), entry(1001));
  await post(key(1), entry(1001));
  await expect(
    post(key(1), entry(2000), "adjustment", {}, "different"),
  ).rejects.toThrow("Idempotency");
  await expect(post(key(2), entry(-1002))).rejects.toThrow("Insufficient");
  await expect(
    post(key(3), [
      { currency: "JOD", account: "available", amount_minor: 1 },
      { currency: "JOD", account: "external", amount_minor: -2 },
    ]),
  ).rejects.toThrow("Unbalanced");
  await expect(post(key(4), null)).rejects.toThrow("Invalid transaction");
  expect(
    await rows(
      "select available_minor::text from wallets where auth0_sub=$1 and currency='JOD'",
      [alice],
    ),
  ).toEqual([{ available_minor: "1001" }]);
  expect(await rows("select count(*)::int as count from transactions")).toEqual(
    [{ count: 1 }],
  );
  expect(
    await rows("select count(*)::int as count from ledger_entries"),
  ).toEqual([{ count: 2 }]);
});
it("prevents a second refund using a different request key", async () => {
  const result = await post(key(5), entry(-100), "purchase");
  const purchase = (
    result.rows[0] as { walletwise_apply_transaction: { id: string } }
  ).walletwise_apply_transaction;
  await post(key(6), entry(100), "refund", { originalId: purchase.id });
  await expect(
    post(key(7), entry(100), "refund", { originalId: purchase.id }),
  ).rejects.toThrow("one_refund_per_purchase");
});
it("completes onboarding only once and atomically persists all wallet preferences", async () => {
  const onboard =
    "select walletwise_complete_onboarding($1,$2,'a@example.com',true,'JOD',true,true)";
  await db.query(onboard, [alice, "Alice"]);
  await db.query(onboard, [alice, "Overwritten"]);
  await db.query("select walletwise_patch_preferences($1,$2)", [
    alice,
    JSON.stringify({
      frequency: "weekly",
      increments: { ILS: 100, USD: 50, JOD: 250 },
      caps: { ILS: 200, USD: 100, JOD: 500 },
    }),
  ]);
  expect(
    await rows(
      "select full_name,wallet_preferences->>'frequency' as frequency from profiles where auth0_sub=$1",
      [alice],
    ),
  ).toEqual([{ full_name: "Alice", frequency: "weekly" }]);
  expect(
    await rows(
      "select increment_minor::text from savings_rules where auth0_sub=$1 and currency='JOD'",
      [alice],
    ),
  ).toEqual([{ increment_minor: "250" }]);
});
it("accepts savings recommendations atomically, retries safely, and rejects stale settings", async () => {
  const latest = (
    await rows(
      "select id::text from transactions where auth0_sub=$1 order by occurred_at desc,id desc limit 1",
      [alice],
    )
  )[0] as { id: string };
  const sql = "select walletwise_accept_savings_rule($1,'JOD',250,$2,500,$3)";
  await db.query(sql, [alice, 500, latest.id]);
  await db.query(sql, [alice, 500, latest.id]);
  expect(
    await rows(
      "select increment_minor::text from savings_rules where auth0_sub=$1 and currency='JOD'",
      [alice],
    ),
  ).toEqual([{ increment_minor: "500" }]);
  await expect(db.query(sql, [alice, 501, latest.id])).rejects.toThrow(
    "Savings settings changed",
  );
  await expect(db.query(sql, [alice, 500, "stale-revision"])).rejects.toThrow(
    "Savings settings changed",
  );
});
it("enforces ownership on every user table and rejects direct writes and privileged RPC calls", async () => {
  await db.query(
    "select walletwise_apply_transaction($1,$2,'bob-fixture','adjustment','Fixture','Other',$3::jsonb)",
    [bob, key(20), JSON.stringify(entry(5))],
  );
  await db.exec("reset role");
  // Populate the remaining tables under the migration owner, not a client identity.
  for (const sub of [alice, bob]) {
    await db.query(
      "insert into savings_goals(id,auth0_sub,currency,name,target_minor) values(gen_random_uuid(),$1,'JOD','Goal',1000)",
      [sub],
    );
    await db.query(
      "insert into savings_allocations(auth0_sub,goal_id,currency,amount_minor) select auth0_sub,id,currency,1 from savings_goals where auth0_sub=$1",
      [sub],
    );
    await db.query(
      "insert into currency_alerts(auth0_sub,from_currency,to_currency,direction,threshold,reference_units) values($1,'ILS','JOD','increase',1,1)",
      [sub],
    );
    await db.query(
      "insert into notifications(auth0_sub,title,body) values($1,'Hello','World')",
      [sub],
    );
    await db.query(
      "insert into ai_reports(auth0_sub,frequency,report) values($1,'weekly','{}')",
      [sub],
    );
  }
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "authenticated", sub: alice }),
  ]);
  for (const table of tables) {
    const result = await rows(`select distinct auth0_sub from ${table}`);
    expect(result, table).toEqual([{ auth0_sub: alice }]);
    await expect(db.exec(`delete from ${table}`)).rejects.toThrow(
      "permission denied",
    );
    await expect(
      db.exec(`update ${table} set auth0_sub='paypal|bob'`),
    ).rejects.toThrow("permission denied");
    await expect(
      db.exec(`insert into ${table} default values`),
    ).rejects.toThrow("permission denied");
  }
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "authenticated", sub: bob }),
  ]);
  for (const table of tables)
    expect(
      await rows(`select distinct auth0_sub from ${table}`),
      table,
    ).toEqual([{ auth0_sub: bob }]);
  await expect(
    db.exec("update wallets set available_minor=100000"),
  ).rejects.toThrow("permission denied");
  await expect(initialize(bob)).rejects.toThrow("permission denied");
  await expect(post(key(8), entry(1))).rejects.toThrow("permission denied");
  for (const claims of [
    { sub: alice },
    { role: "authenticated" },
    { role: "anon", sub: alice },
  ]) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify(claims),
    ]);
    expect(await rows("select * from profiles")).toEqual([]);
  }
  await db.exec("set role anon");
  await expect(db.exec("select * from profiles")).rejects.toThrow(
    "permission denied",
  );
  await db.exec(
    "reset role; create table public.future_private_data(id int); set role authenticated",
  );
  await expect(db.exec("select * from future_private_data")).rejects.toThrow(
    "permission denied",
  );
});

it("persists shared Forex snapshots with browser read-only RLS and bucketed history", async () => {
  await db.exec("set role service_role");
  const stamp = new Date().toISOString();
  await db.query(
    "insert into forex_snapshots(id,observed_at,fetched_at,snapshot) values($1,$2,$2,$3::jsonb)",
    [
      "quote-one",
      stamp,
      JSON.stringify({ id: "quote-one", publishedAt: stamp }),
    ],
  );
  expect(
    await rows("select * from forex_history(now()-interval '1 hour',60)"),
  ).toHaveLength(1);
  await db.exec("set role authenticated");
  expect(await rows("select id from forex_snapshots")).toEqual([
    { id: "quote-one" },
  ]);
  await expect(db.exec("delete from forex_snapshots")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.exec("select * from forex_history(now()-interval '1 hour',60)"),
  ).rejects.toThrow("permission denied");
  await db.exec("set role anon");
  await expect(db.exec("select * from forex_snapshots")).rejects.toThrow(
    "permission denied",
  );
});
