import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { initialUser } from "../shared/ledger";
let db: PGlite;
const sub = "auth0|progressive",
  other = "auth0|other",
  uid = "progressive",
  goal = randomUUID();
let original = "";
async function scalar<T = unknown>(sql: string, args: unknown[] = []) {
  return Object.values((await db.query(sql, args)).rows[0] as object)[0] as T;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.exec("set role service_role");
  for (const owner of [sub, other])
    await scalar("select walletwise_initialize_user($1)", [owner]);
  const state = initialUser();
  state.goals = [
    {
      id: goal,
      name: "Owned goal",
      target: 10000,
      currency: "USD",
      createdAt: new Date().toISOString(),
    },
  ];
  const stored = {
    ...state,
    ledger: Array.from({ length: 5000 }, () => ({
      description: "Legacy fixture history",
    })),
    reports: Array.from({ length: 12 }, (_, id) => ({ id: String(id) })),
    operations: { privateOperation: { result: "excluded" } },
  };
  await db.query(
    "insert into account_state(user_id,auth0_sub,state) values($1,$2,$3::jsonb)",
    [uid, sub, JSON.stringify(stored)],
  );
  const funding = await scalar<{ id: string }>(
    "select walletwise_funding_reserve($1,$2,$3,$4,$5)",
    [sub, randomUUID(), "funding", "USD", 20000],
  );
  await scalar("select walletwise_funding_status($1,$2,'CREATED','ORDER')", [
    sub,
    funding.id,
  ]);
  await scalar("select walletwise_funding_credit($1,$2,$3,$4,$5)", [
    sub,
    funding.id,
    "CAPTURE",
    "USD",
    20000,
  ]);
  for (let i = 0; i < 61; i++) {
    const posted = await scalar<{ id: string }>(
      "select walletwise_apply_transaction($1,$2,$3,'purchase','Fixture purchase','Food & Drink',$4::jsonb,$5::jsonb)",
      [
        sub,
        randomUUID(),
        String(i),
        JSON.stringify([
          { currency: "USD", account: "available", amount_minor: -110 },
          { currency: "USD", account: "external", amount_minor: 100 },
          { currency: "USD", account: "savings", amount_minor: 10 },
        ]),
        JSON.stringify({ goalId: goal }),
      ],
    );
    if (i === 0) original = posted.id;
  }
  await scalar(
    "select walletwise_apply_transaction($1,$2,'refund','refund','Refund','Food & Drink',$3::jsonb,$4::jsonb)",
    [
      sub,
      randomUUID(),
      JSON.stringify([
        { currency: "USD", account: "available", amount_minor: 110 },
        { currency: "USD", account: "external", amount_minor: -100 },
        { currency: "USD", account: "savings", amount_minor: -10 },
      ]),
      JSON.stringify({ goalId: goal, originalId: original }),
    ],
  );
}, 30000);
afterAll(async () => await db.close());
it("projects bounded dashboard data and exact aggregates without transferring private ledger/operation history", async () => {
  const data = await scalar<{
    goals: { name: string }[];
    reports: unknown[];
    reportTotal: number;
    dashboard: {
      dailySpending: { amount: string }[];
      goalTotals: Record<string, string>;
    };
  }>("select walletwise_dashboard($1,$2,'UTC')", [sub, uid]);
  expect(data.goals[0].name).toBe("Owned goal");
  expect(data.reports).toHaveLength(5);
  expect(data.reportTotal).toBe(12);
  expect(data).not.toHaveProperty("ledger");
  expect(data).not.toHaveProperty("operations");
  expect(
    data.dashboard.dailySpending.reduce((sum, r) => sum + Number(r.amount), 0),
  ).toBe(6000); // 6100 in purchases minus the 100 merchant refund.
  expect(data.dashboard.goalTotals[goal]).toBe("600");
});
it("paginates complete activity with a stable cursor, without duplicates or losing equal timestamps", async () => {
  let before: string | null = null,
    id: string | null = null;
  const seen = new Set<string>();
  let pages = 0;
  for (;;) {
    const rows: {
      id: string;
      occurred_at: string;
      ledger_entries: { amount_minor: string }[];
    }[] = await scalar<
      {
        id: string;
        occurred_at: string;
        ledger_entries: { amount_minor: string }[];
      }[]
    >("select walletwise_activity_page($1,$2,$3,25)", [sub, before, id]);
    if (!rows.length) break;
    pages++;
    expect(rows.length).toBeLessThanOrEqual(25);
    for (const row of rows) {
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
      expect(row.ledger_entries.length).toBeGreaterThanOrEqual(2);
      expect(
        row.ledger_entries.reduce((sum, e) => sum + Number(e.amount_minor), 0),
      ).toBe(0);
    }
    before = rows.at(-1)!.occurred_at;
    id = rows.at(-1)!.id;
  }
  expect(pages).toBe(3);
  expect(seen.size).toBe(63);
});
it("applies currency/category/savings filters on the database before the page limit", async () => {
  expect(
    await scalar("select walletwise_activity_page($1,null,null,25,$2)", [
      sub,
      "JOD",
    ]),
  ).toEqual([]);
  const rows = await scalar<{ kind: string }[]>(
    "select walletwise_activity_page($1,null,null,100,'USD','Food & Drink',true)",
    [sub],
  );
  expect(rows).toHaveLength(62);
  expect(rows.some((r) => r.kind === "adjustment")).toBe(false);
});
it("paginates saved reports and isolates subjects and auxiliary account keys", async () => {
  expect(
    await scalar("select walletwise_report_page($1,$2,5,5)", [sub, uid]),
  ).toEqual({
    reports: [{ id: "5" }, { id: "6" }, { id: "7" }, { id: "8" }, { id: "9" }],
    total: 12,
  });
  expect(
    await scalar("select walletwise_dashboard($1,$2)", [other, uid]),
  ).toBeNull();
  expect(await scalar("select walletwise_activity_page($1)", [other])).toEqual(
    [],
  );
});
it("keeps all new read functions service-only and leaves browser RLS grants unchanged", async () => {
  await db.exec("set role authenticated");
  try {
    await expect(
      db.query("select walletwise_dashboard($1,$2)", [sub, uid]),
    ).rejects.toThrow();
    await expect(
      db.query("select walletwise_activity_page($1)", [sub]),
    ).rejects.toThrow();
    await expect(
      db.query("select walletwise_report_page($1,$2)", [sub, uid]),
    ).rejects.toThrow();
  } finally {
    await db.exec("set role service_role");
  }
});
