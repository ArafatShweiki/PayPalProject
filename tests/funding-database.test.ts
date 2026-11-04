import type { FundingOrder } from "../shared/types";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;`,
  );
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(
      readFileSync(`supabase/migrations/${f}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.exec("set role service_role");
}, 30000);
afterAll(async () => await db.close());
async function scalar<T = FundingOrder>(sql: string, args: unknown[] = []) {
  return Object.values((await db.query(sql, args)).rows[0] as object)[0] as T;
}
async function reserve(
  sub = `auth0|${randomUUID()}`,
  key: string = randomUUID(),
  amount = 5000,
  currency = "USD",
) {
  const order = await scalar(
    "select walletwise_funding_reserve($1,$2,$3,$4,$5)",
    [sub, key, `${currency}:${amount}`, currency, amount],
  );
  await scalar(
    "select walletwise_funding_status($1,$2,'CREATED',$3,'https://www.sandbox.paypal.com/checkoutnow')",
    [sub, order.id, randomUUID()],
  );
  return order;
}
const credit = (
  o: FundingOrder,
  capture = randomUUID(),
  amount = o.amount_minor,
  currency = o.currency,
) =>
  scalar("select walletwise_funding_credit($1,$2,$3,$4,$5)", [
    o.auth0_sub,
    o.id,
    capture,
    currency,
    amount,
  ]);
const balance = (sub: string) =>
  scalar(
    "select available_minor::text from wallets where auth0_sub=$1 and currency='USD'",
    [sub],
  );
it.each(["USD", "ILS"])(
  "atomically persists %s funding only in the selected wallet with no savings allocation",
  async (currency) => {
    const o = await reserve(undefined, undefined, 1234, currency);
    const capture = randomUUID();
    const result = await credit(o, capture);
    await credit(o, capture);
    expect(
      (
        await db.query(
          "select currency,available_minor::text,savings_minor::text from wallets where auth0_sub=$1 order by currency",
          [o.auth0_sub],
        )
      ).rows,
    ).toEqual(
      ["ILS", "JOD", "USD"].map((c) => ({
        currency: c,
        available_minor: c === currency ? "1234" : "0",
        savings_minor: "0",
      })),
    );
    expect(
      (
        await db.query(
          "select currency,account,amount_minor::text from ledger_entries where transaction_id=$1 order by account",
          [result.transaction_id],
        )
      ).rows,
    ).toEqual([
      { currency, account: "available", amount_minor: "1234" },
      { currency, account: "external", amount_minor: "-1234" },
    ]);
    expect(
      await scalar(
        "select count(*)::int from transactions where auth0_sub=$1",
        [o.auth0_sub],
      ),
    ).toBe(1);
  },
);
it("initializes zero wallets and never funds pending, canceled or failed orders", async () => {
  const o = await reserve();
  expect(await balance(o.auth0_sub)).toBe("0");
  for (const state of ["PENDING", "FAILED", "CANCELED"])
    await scalar("select walletwise_funding_status($1,$2,$3)", [
      o.auth0_sub,
      o.id,
      state,
    ]);
  expect(await balance(o.auth0_sub)).toBe("0");
  expect(
    await scalar("select count(*)::int from wallets where auth0_sub=$1", [
      o.auth0_sub,
    ]),
  ).toBe(3);
});
it("credits balanced postings once for repeated and concurrent capture completions", async () => {
  const o = await reserve(),
    id = randomUUID();
  const result = await Promise.all([
    credit(o, id),
    credit(o, id),
    credit(o, id),
  ]);
  expect(new Set(result.map((v) => v.transaction_id)).size).toBe(1);
  expect(await balance(o.auth0_sub)).toBe("5000");
  expect(
    await scalar(
      "select sum(amount_minor)::text from ledger_entries where transaction_id=$1",
      [result[0].transaction_id],
    ),
  ).toBe("0");
  expect(
    await scalar(
      "select savings_minor::text from wallets where auth0_sub=$1 and currency='USD'",
      [o.auth0_sub],
    ),
  ).toBe("0");
});
it("enforces globally unique capture IDs and rolls back the losing credit", async () => {
  const a = await reserve(),
    b = await reserve(),
    id = randomUUID();
  await credit(a, id);
  await expect(credit(b, id)).rejects.toThrow();
  expect(await balance(b.auth0_sub)).toBe("0");
});
it("rejects mismatched currency, amount, ownership and reused request contents", async () => {
  const o = await reserve();
  await expect(credit(o, randomUUID(), 4999)).rejects.toThrow();
  await expect(credit(o, randomUUID(), 5000, "ILS")).rejects.toThrow();
  await expect(credit({ ...o, auth0_sub: "auth0|other" })).rejects.toThrow();
  await expect(reserve(o.auth0_sub, o.request_id, 7000)).rejects.toThrow();
  expect(await balance(o.auth0_sub)).toBe("0");
});
it("rejects direct JOD funding and unsafe amounts", async () => {
  await expect(reserve(undefined, undefined, 5000, "JOD")).rejects.toThrow();
  await expect(reserve(undefined, undefined, 0)).rejects.toThrow();
  await expect(reserve(undefined, undefined, 10000001)).rejects.toThrow();
});
it("retains a recoverable order when ledger persistence fails", async () => {
  const o = await reserve(),
    capture = randomUUID();
  await db.exec("reset role");
  await db.query(
    "update wallets set available_minor=9007199254740991 where auth0_sub=$1 and currency='USD'",
    [o.auth0_sub],
  );
  await db.exec("set role service_role");
  await expect(credit(o, capture)).rejects.toThrow();
  expect(
    await scalar("select capture_id from funding_orders where id=$1", [o.id]),
  ).toBeNull();
  await db.exec("reset role");
  await db.query(
    "update wallets set available_minor=0 where auth0_sub=$1 and currency='USD'",
    [o.auth0_sub],
  );
  await db.exec("set role service_role");
  await credit(o, capture);
  expect(await balance(o.auth0_sub)).toBe("5000");
});
it("reverses verified full refunds once, without counting them as purchase refunds", async () => {
  const o = await reserve(),
    capture = randomUUID();
  await credit(o, capture);
  const a = await scalar("select walletwise_funding_reverse($1,$2,$3)", [
    o.auth0_sub,
    o.id,
    capture,
  ]);
  const b = await scalar("select walletwise_funding_reverse($1,$2,$3)", [
    o.auth0_sub,
    o.id,
    capture,
  ]);
  expect(a.reversal_id).toBe(b.reversal_id);
  expect(a.status).toBe("REVERSED");
  expect(await balance(o.auth0_sub)).toBe("0");
});
it("records review instead of making a negative wallet after spent funding is refunded", async () => {
  const o = await reserve(),
    capture = randomUUID();
  await credit(o, capture);
  await scalar(
    "select walletwise_apply_transaction($1,$2,'spent','adjustment','test','Other',$3)",
    [
      o.auth0_sub,
      randomUUID(),
      JSON.stringify([
        { currency: "USD", account: "available", amount_minor: -5000 },
        { currency: "USD", account: "external", amount_minor: 5000 },
      ]),
    ],
  );
  const result = await scalar("select walletwise_funding_reverse($1,$2,$3)", [
    o.auth0_sub,
    o.id,
    capture,
  ]);
  expect(result.status).toBe("REFUND_REVIEW");
  expect(await balance(o.auth0_sub)).toBe("0");
});
it("keeps funding and auxiliary records owner-readable and denies browser mutations", async () => {
  const o = await reserve();
  await db.query(
    "insert into account_state(user_id,auth0_sub,state) values($1,$2,'{}')",
    [randomUUID(), o.auth0_sub],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: o.auth0_sub, role: "authenticated" }),
  ]);
  try {
    expect(await scalar("select count(*)::int from funding_orders")).toBe(1);
    await expect(
      db.query("select walletwise_funding_credit($1,$2,$3,$4,$5)", [
        o.auth0_sub,
        o.id,
        "FORGED",
        "USD",
        5000,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("update wallets set available_minor=100"),
    ).rejects.toThrow();
    await expect(
      db.query("update account_state set state='{}'"),
    ).rejects.toThrow();
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: "other", role: "authenticated" }),
    ]);
    expect(await scalar("select count(*)::int from funding_orders")).toBe(0);
    expect(await scalar("select count(*)::int from account_state")).toBe(0);
  } finally {
    await db.exec("set role service_role");
  }
});
