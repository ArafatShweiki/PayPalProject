import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { initialUser } from "../shared/ledger";
it("baselines existing and previously reached Circles without changing money or inventing activity", async () => {
  const db = new PGlite();
  async function rpc<T = unknown>(
    name: string,
    args: unknown[] = [],
  ): Promise<T> {
    const r = await db.query<Record<string, T>>(
      `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    );
    return r.rows[0].value;
  }
  const sub = "auth0|existing-migration-user",
    file = "202611060002_product_enhancements.sql";
  const command = (action: string, id: string | null, payload: object) =>
    rpc<{ id: string; proposalId: string }>("walletwise_circle_command", [
      sub,
      action,
      id,
      randomUUID(),
      JSON.stringify(payload),
    ]);
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt()returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$",
    );
    for (const name of readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql") && n < file)
      .sort())
      await db.exec(
        readFileSync(`supabase/migrations/${name}`, "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    await rpc("walletwise_initialize_user", [sub]);
    await db.query(
      "insert into account_state(user_id,auth0_sub,state)values($1,$1,$2::jsonb)",
      [sub, JSON.stringify(initialUser())],
    );
    await rpc("walletwise_apply_transaction", [
      sub,
      randomUUID(),
      "fund",
      "adjustment",
      "Test funding",
      "Funding",
      JSON.stringify([
        { currency: "USD", account: "available", amount_minor: 10000 },
        { currency: "USD", account: "external", amount_minor: -10000 },
      ]),
      "{}",
    ]);
    async function contribute(id: string, amount: number) {
      const q = (
        await db.query<{ id: string }>(
          "insert into savings_quotes(auth0_sub,destination_kind,destination_id,source_currency,source_minor,target_currency,target_minor,rate_units,source,observed_at,expires_at,snapshot_id)values($1,'circle',$2,'USD',$3,'USD',$3,1000000,'Test',now(),now()+interval '2 minutes','test')returning id",
          [sub, id, amount],
        )
      ).rows[0].id;
      await rpc("walletwise_circle_contribute", [
        sub,
        id,
        randomUUID(),
        randomUUID(),
        "USD",
        amount,
        q,
        null,
      ]);
    }
    const a = await command("create", null, {
      name: "Partly funded",
      currency: "USD",
      target: 1000,
    });
    await contribute(a.id, 800);
    const b = await command("create", null, {
      name: "Previously reached",
      currency: "USD",
      target: 1000,
    });
    await contribute(b.id, 1000);
    const proposal = await command("propose", b.id, {
      kind: "return_all",
      amount: 1000,
      currency: "USD",
      reason: "Return shares",
      destination: null,
    });
    await command("vote", b.id, {
      proposalId: proposal.proposalId,
      decision: "Approve",
    });
    await command("execute", b.id, { proposalId: proposal.proposalId });
    const before = (
      await db.query(
        "select available_minor,savings_minor from wallets where auth0_sub=$1 order by currency",
        [sub],
      )
    ).rows;
    const countBefore = await rpc<number>("jsonb_array_length", [
      (
        await db.query<{ state: { notices: unknown[] } }>(
          "select state from account_state where auth0_sub=$1",
          [sub],
        )
      ).rows[0].state.notices,
    ]);
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    expect(
      (
        await db.query(
          "select available_minor,savings_minor from wallets where auth0_sub=$1 order by currency",
          [sub],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (await db.query("select * from circle_activity where event='milestone'"))
        .rows,
    ).toEqual([]);
    const notices = (
      await db.query<{ n: number }>(
        "select jsonb_array_length(state->'notices') n from account_state where auth0_sub=$1",
        [sub],
      )
    ).rows[0].n;
    expect(notices).toBe(countBefore);
    expect(
      (
        await db.query<{ threshold: number }>(
          "select threshold from circle_milestones where circle_id=$1 order by threshold",
          [b.id],
        )
      ).rows.map((r) => r.threshold),
    ).toEqual([25, 50, 75, 100]);
    await contribute(a.id, 200);
    expect(
      (
        await db.query(
          "select details->>'threshold' threshold from circle_activity where circle_id=$1 and event='milestone'",
          [a.id],
        )
      ).rows,
    ).toEqual([{ threshold: "100" }]);
    await expect(
      command("propose", b.id, {
        kind: "target",
        amount: 2000,
        currency: "USD",
        reason: "New goal",
        destination: null,
      }),
    ).rejects.toThrow(/No outstanding contribution/);
  } finally {
    await db.close();
  }
}, 30000);
