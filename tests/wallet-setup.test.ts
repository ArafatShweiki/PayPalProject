import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";

const setup = readFileSync("supabase/setup-wallet.sql", "utf8").replace(
  "create extension if not exists pgcrypto;",
  "",
);
const forexMigration = readFileSync(
  "supabase/migrations/202610290001_forex_snapshots.sql",
  "utf8",
);
let db: PGlite;
async function database() {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as
    $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;`);
}
afterEach(async () => {
  await db?.close();
});

it("preserves existing forex rows, index, function and policies while installing the full wallet", async () => {
  await database();
  await db.exec(forexMigration);
  await db.exec(`insert into forex_snapshots values ('original','2026-10-30Z','2026-10-30Z','{"source":"original","rates":[1,2,3]}');
    create policy existing_forex_policy on forex_snapshots for select to authenticated using (id='original');`);
  const before = await db.query(
    "select *,tableoid::oid as table_oid from forex_snapshots",
  );
  const defaults = await db.query("select * from pg_default_acl order by oid");
  await db.exec(setup);
  expect(
    (await db.query("select *,tableoid::oid as table_oid from forex_snapshots"))
      .rows,
  ).toEqual(before.rows);
  expect(
    (await db.query("select * from pg_default_acl order by oid")).rows,
  ).toEqual(defaults.rows);
  expect(
    (
      await db.query(
        "select polname from pg_policy where polrelid='forex_snapshots'::regclass order by polname",
      )
    ).rows,
  ).toEqual([{ polname: "existing_forex_policy" }, { polname: "forex_read" }]);
  await db.exec(
    "set role service_role; select walletwise_initialize_user('auth0|setup-test');",
  );
  expect(
    (
      await db.query(
        "select currency,available_minor from wallets order by currency",
      )
    ).rows,
  ).toEqual(
    ["ILS", "JOD", "USD"].map((currency) => ({ currency, available_minor: 0 })),
  );
  await db.exec(
    'reset role; set role authenticated; set request.jwt.claims = \'{"sub":"auth0|other","role":"authenticated"}\';',
  );
  expect((await db.query("select * from profiles")).rows).toEqual([]);
  await expect(
    db.query(
      "insert into wallets(auth0_sub,currency) values('auth0|other','USD')",
    ),
  ).rejects.toThrow(/permission denied/);
}, 30000);

it("installs on an empty project too", async () => {
  await database();
  await db.exec(setup);
  expect(
    (
      await db.query(
        "select to_regprocedure('walletwise_dashboard(text,text,text)') is not null as installed",
      )
    ).rows,
  ).toEqual([{ installed: true }]);
}, 30000);

it("reuses a bare forex table and adds its missing index, policy and history function", async () => {
  await database();
  await db.exec(`create table forex_snapshots (id text primary key,observed_at timestamptz not null,fetched_at timestamptz not null,snapshot jsonb not null);
    insert into forex_snapshots values ('keep',now(),now(),'{"keep":true}');`);
  await db.exec(setup);
  expect(
    (await db.query("select id,snapshot from forex_snapshots")).rows,
  ).toEqual([{ id: "keep", snapshot: { keep: true } }]);
  expect(
    (await db.query("select * from forex_history(now()-interval '1 day',60)"))
      .rows,
  ).toEqual([{ forex_history: { keep: true } }]);
}, 30000);

it.each([
  [
    "create table profiles (sentinel text); insert into profiles values ('preserve');",
    /public.profiles already exists/,
  ],
  [
    "create table forex_snapshots (id uuid primary key,observed_at timestamptz not null,fetched_at timestamptz not null,snapshot jsonb not null);",
    /forex_snapshots.id must be text/,
  ],
  [
    "create table transactions_owner_cursor (sentinel text);",
    /public.transactions_owner_cursor already exists/,
  ],
  [
    "create function forex_history(timestamptz,integer) returns setof jsonb language sql as $$select '{}'::jsonb$$;",
    /existing forex_history differs/,
  ],
])(
  "aborts safely for schema conflicts: %s",
  async (conflict, message) => {
    await database();
    await db.exec(conflict);
    const before = (
      await db.query(
        "select oid,relname from pg_class where relnamespace='public'::regnamespace order by oid",
      )
    ).rows;
    await expect(db.exec(setup)).rejects.toThrow(message);
    await db.exec("rollback");
    expect(
      (
        await db.query(
          "select oid,relname from pg_class where relnamespace='public'::regnamespace order by oid",
        )
      ).rows,
    ).toEqual(before);
  },
  30000,
);
