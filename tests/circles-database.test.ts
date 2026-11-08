import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { initialUser } from "../shared/ledger";
import { buildReport } from "../shared/reports";
import { mapTransaction } from "../server/database-state";
import type { StoredTransaction } from "../server/supabase";
import { convert, type Currency } from "../shared/money";
import type { CircleDetail } from "../shared/circles";
let db: PGlite;
afterEach(async () => {
  if (!db) return;
  await db.exec("reset role;set role service_role");
  expect(
    (
      await db.query(
        "select transaction_id,currency from ledger_entries group by transaction_id,currency having sum(amount_minor)<>0",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "select w.id from wallets w where w.available_minor<>coalesce((select sum(l.amount_minor) from ledger_entries l where l.auth0_sub=w.auth0_sub and l.currency=w.currency and l.account='available'),0) or w.savings_minor<>coalesce((select sum(l.amount_minor) from ledger_entries l where l.auth0_sub=w.auth0_sub and l.currency=w.currency and l.account='savings'),0) or w.available_minor<0 or w.savings_minor<0",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "select c.id from savings_circles c where c.balance_minor<>coalesce((select sum(m.outstanding_minor) from circle_members m where m.circle_id=c.id),0) or c.balance_minor<>coalesce((select sum(e.amount_minor) from circle_entries e where e.circle_id=c.id),0)",
      )
    ).rows,
  ).toEqual([]);
});
async function scalar<T = unknown>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  return Object.values((await db.query(sql, args)).rows[0] as object)[0] as T;
}
async function rpc<T = unknown>(name: string, args: unknown[]): Promise<T> {
  return scalar(
    `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")})`,
    args,
  );
}
async function account() {
  const sub = `auth0|${randomUUID()}`;
  await rpc("walletwise_initialize_user", [sub]);
  await rpc("walletwise_complete_onboarding", [
    sub,
    "Test member",
    null,
    false,
    "USD",
    true,
    false,
  ]);
  await db.query(
    "insert into account_state(user_id,auth0_sub,state)values($1,$1,$2::jsonb)",
    [sub, JSON.stringify(initialUser())],
  );
  for (const c of ["ILS", "USD", "JOD"])
    await rpc("walletwise_apply_transaction", [
      sub,
      randomUUID(),
      "fund",
      "adjustment",
      "Test funds",
      "Funding",
      JSON.stringify([
        { currency: c, account: "available", amount_minor: 100000 },
        { currency: c, account: "external", amount_minor: -100000 },
      ]),
      "{}",
    ]);
  return sub;
}
async function goal(
  sub: string,
  currency: Currency = "USD",
  makeDefault = true,
  target = 100000,
) {
  return rpc<{ id: string }>("walletwise_create_savings_goal", [
    sub,
    sub,
    randomUUID(),
    randomUUID(),
    JSON.stringify({ name: "Goal", currency, target }),
    makeDefault,
  ]);
}
async function command(
  sub: string,
  action: string,
  id: string | null,
  payload: unknown = {},
  key = randomUUID(),
) {
  return rpc<{ id: string; proposalId: string; status: string }>(
    "walletwise_circle_command",
    [sub, action, id, key, JSON.stringify(payload)],
  );
}
async function circle(sub: string, target = 100000) {
  return command(sub, "create", null, {
    name: "Family trip",
    currency: "USD",
    target,
  });
}
async function detail(sub: string, id: string) {
  return rpc<CircleDetail>("walletwise_circles", [sub, id]);
}
async function quote(
  sub: string,
  kind: "goal" | "circle",
  id: string,
  from: Currency,
  to: Currency,
  value: number,
  rate = 1000000,
) {
  return scalar<string>(
    "insert into savings_quotes(auth0_sub,destination_kind,destination_id,source_currency,source_minor,target_currency,target_minor,rate_units,source,observed_at,expires_at,snapshot_id)values($1,$2,$3,$4,$5,$6,$7,$8,'Test verified quote',now(),now()+interval '2 minutes','test')returning id",
    [sub, kind, id, from, value, to, convert(value, from, to, rate), rate],
  );
}
async function buy(
  sub: string,
  currency: Currency = "USD",
  value = 1235,
  q: string | null = null,
  skip = false,
  key = randomUUID(),
) {
  return rpc<{ id: string; metadata: Record<string, unknown> }>(
    "walletwise_goal_purchase",
    [
      sub,
      key,
      `${currency}:${value}:${skip}`,
      currency,
      value,
      "Coffee",
      "Food & drink",
      q,
      skip,
    ],
  );
}
async function contribute(
  sub: string,
  id: string,
  value = 100,
  from: Currency = "USD",
  rate = 1000000,
  sourceGoal: string | null = null,
  key = randomUUID(),
) {
  const q = await quote(sub, "circle", id, from, "USD", value, rate);
  return rpc<{ id: string }>("walletwise_circle_contribute", [
    sub,
    id,
    key,
    `${from}:${value}:${sourceGoal}`,
    from,
    value,
    q,
    sourceGoal,
  ]);
}
async function invite(owner: string, id: string) {
  const raw = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(raw).digest("hex");
  await command(owner, "invite", id, { hash });
  return { raw, hash };
}
async function join(owner: string, member: string, id: string) {
  const invitation = await invite(owner, id);
  await command(member, "join", null, { hash: invitation.hash });
  return invitation;
}
async function proposal(
  owner: string,
  id: string,
  kind = "withdraw",
  value = 100,
  destination?: string,
) {
  const c = await detail(owner, id);
  return command(owner, "propose", id, {
    kind,
    amount: value,
    currency: "USD",
    reason: "Approved shared goal",
    destination: destination ?? c.members.find((m) => m.you)!.id,
  });
}
async function approve(
  sub: string,
  id: string,
  p: string,
  decision = "Approve",
) {
  return command(sub, "vote", id, { proposalId: p, decision });
}
async function wallet(sub: string, currency = "USD") {
  return scalar<{ available_minor: number; savings_minor: number }>(
    "select jsonb_build_object('available_minor',available_minor,'savings_minor',savings_minor) from wallets where auth0_sub=$1 and currency=$2",
    [sub, currency],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt()returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;",
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.exec("set role service_role");
}, 30000);
afterAll(async () => {
  await db.close();
});
it("lists only joined circles and never returns private account identifiers", async () => {
  const owner = await account(),
    other = await account(),
    c = await circle(owner);
  const visible = await rpc<{ id: string }[]>("walletwise_circles", [owner]);
  expect(visible.map((v) => v.id)).toContain(c.id);
  expect(await rpc("walletwise_circles", [other])).toEqual([]);
  expect(JSON.stringify(visible)).not.toContain(owner);
});
it("requires a real goal for activation and never silently deducts an unassigned round-up", async () => {
  const sub = await account(),
    before = await wallet(sub);
  await expect(
    rpc("walletwise_patch_preferences", [
      sub,
      JSON.stringify({ savings: "enabled" }),
    ]),
  ).rejects.toThrow(/Choose a savings goal/);
  await expect(buy(sub)).rejects.toThrow(/Choose a savings goal/);
  expect(await wallet(sub)).toEqual(before);
  await buy(sub, "USD", 1235, null, true);
  expect(await wallet(sub)).toEqual({
    available_minor: 98765,
    savings_minor: 0,
  });
});
it.each([
  ["USD", 1235, 65, 1000000, 65],
  ["ILS", 1600, 400, 285714, 114],
  ["JOD", 7350, 650, 1400000, 91],
] as const)(
  "saves %s purchases directly into a USD goal with integer conversion",
  async (currency, value, saved, rate, credit) => {
    const sub = await account(),
      g = await goal(sub),
      q = await quote(sub, "goal", g.id, currency, "USD", saved, rate),
      tx = await buy(sub, currency, value, q);
    expect(await wallet(sub, currency)).toEqual({
      available_minor: 100000 - value - saved,
      savings_minor: currency === "USD" ? credit : 0,
    });
    expect((await wallet(sub)).savings_minor).toBe(credit);
    expect(
      await scalar(
        "select sum(amount_minor)::integer from goal_savings_entries where goal_id=$1",
        [g.id],
      ),
    ).toBe(credit);
    expect(tx.metadata.purchaseAmount).toBe(value);
    const balances = (
      await db.query<{ currency: string; balance: number }>(
        "select currency,sum(amount_minor)::integer as balance from ledger_entries where transaction_id=$1 group by currency",
        [tx.id],
      )
    ).rows;
    expect(balances.every((b) => b.balance === 0)).toBe(true);
  },
);
it.each([
  ["USD", "ILS", 1235, 65, 3500000, 228],
  ["USD", "JOD", 1235, 65, 700000, 455],
  ["ILS", "USD", 1600, 400, 285714, 114],
  ["ILS", "JOD", 1600, 400, 200000, 800],
  ["JOD", "USD", 7350, 650, 1400000, 91],
  ["JOD", "ILS", 7350, 650, 5000000, 325],
] as const)(
  "saves and refunds %s to %s without converting the merchant amount",
  async (source, target, value, saved, rate, credit) => {
    const sub = await account(),
      g = await goal(sub, target),
      q = await quote(sub, "goal", g.id, source, target, saved, rate);
    const transaction = await buy(sub, source, value, q);
    expect(transaction.metadata.purchaseAmount).toBe(value);
    expect((await wallet(sub, source)).available_minor).toBe(
      100000 - value - saved,
    );
    expect((await wallet(sub, target)).savings_minor).toBe(credit);
    await rpc("walletwise_goal_refund", [sub, randomUUID(), transaction.id]);
    expect(await wallet(sub, source)).toEqual({
      available_minor: 100000,
      savings_minor: 0,
    });
    expect(await wallet(sub, target)).toEqual({
      available_minor: 100000,
      savings_minor: 0,
    });
  },
);
it("expired, missing, or mismatched conversion quotes never debit funds", async () => {
  const sub = await account(),
    g = await goal(sub),
    before = await wallet(sub, "ILS");
  await expect(buy(sub, "ILS", 1600)).rejects.toThrow(/quote expired/);
  const q = await quote(sub, "goal", g.id, "ILS", "USD", 399, 285714);
  await expect(buy(sub, "ILS", 1600, q)).rejects.toThrow(/quote expired/);
  expect(await wallet(sub, "ILS")).toEqual(before);
});
it("concurrent and replayed goal purchases allocate only once; refunds reverse the exact FX postings", async () => {
  const sub = await account(),
    g = await goal(sub),
    q = await quote(sub, "goal", g.id, "ILS", "USD", 400, 285714),
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => buy(sub, "ILS", 1600, q, false, key)),
  );
  expect(new Set(results.map((t) => t.id)).size).toBe(1);
  await rpc("walletwise_goal_refund", [sub, randomUUID(), results[0].id]);
  expect(await wallet(sub, "ILS")).toEqual({
    available_minor: 100000,
    savings_minor: 0,
  });
  expect((await wallet(sub)).savings_minor).toBe(0);
  await expect(
    rpc("walletwise_goal_refund", [sub, randomUUID(), results[0].id]),
  ).rejects.toThrow();
});
it("creates circles, hashes direct links and requires authenticated member confirmation", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner),
    invitation = await invite(owner, c.id);
  const preview = await rpc<Record<string, unknown>>(
    "walletwise_invitation_preview",
    [invitation.hash],
  );
  expect(preview.name).toBe("Family trip");
  expect(preview.members).toBeUndefined();
  expect(JSON.stringify(preview)).not.toContain(owner);
  const key = randomUUID();
  await command(member, "join", null, { hash: invitation.hash }, key);
  await command(member, "join", null, { hash: invitation.hash }, key);
  await command(member, "join", null, { hash: invitation.hash });
  expect((await detail(owner, c.id)).members).toHaveLength(2);
  expect(
    await scalar(
      "select count(*)::integer from circle_invitations where token_hash=$1",
      [invitation.raw],
    ),
  ).toBe(0);
  expect(JSON.stringify(await detail(member, c.id))).not.toContain(owner);
});
it("recognizes existing members without another join event and lets former members rejoin", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner),
    invitation = await invite(owner, c.id);
  const status = (sub: string) =>
    rpc<{ alreadyMember: boolean; circleId: string | null }>(
      "walletwise_invitation_status",
      [sub, invitation.hash],
    );
  const joinOnce = (sub: string) =>
    rpc<{ alreadyMember: boolean; id: string }>("walletwise_join_circle", [
      sub,
      invitation.hash,
      randomUUID(),
    ]);
  expect(await status(member)).toMatchObject({
    alreadyMember: false,
    circleId: null,
  });
  expect(await status(owner)).toMatchObject({
    alreadyMember: true,
    circleId: c.id,
  });
  expect(await joinOnce(member)).toMatchObject({
    alreadyMember: false,
    id: c.id,
  });
  expect(await status(member)).toMatchObject({
    alreadyMember: true,
    circleId: c.id,
  });
  const events = () =>
    scalar<number>(
      "select count(*)::integer from circle_activity where circle_id=$1 and event='join'",
      [c.id],
    );
  const before = await events();
  expect(await joinOnce(member)).toMatchObject({
    alreadyMember: true,
    id: c.id,
  });
  expect(await joinOnce(owner)).toMatchObject({
    alreadyMember: true,
    id: c.id,
  });
  expect(await events()).toBe(before);
  expect((await detail(owner, c.id)).members).toHaveLength(2);
  await command(member, "leave", c.id);
  expect((await status(member)).alreadyMember).toBe(false);
  expect((await joinOnce(member)).alreadyMember).toBe(false);
  await command(owner, "revoke", c.id);
  expect(await status(member)).toBeNull();
  await expect(joinOnce(member)).rejects.toThrow(/Invitation unavailable/);
});
it("revokes/regenerates invitation links without changing membership or ownership", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner),
    first = await invite(owner, c.id),
    second = await invite(owner, c.id);
  expect(await rpc("walletwise_invitation_preview", [first.hash])).toBeNull();
  await expect(
    command(member, "join", null, { hash: first.hash }),
  ).rejects.toThrow(/Invitation/);
  await command(owner, "revoke", c.id);
  expect(await rpc("walletwise_invitation_preview", [second.hash])).toBeNull();
});
it("cross-currency contributions reconcile member shares, circle funds and wallet debits", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id, 400, "ILS", 285714);
  await contribute(member, c.id, 100);
  const d = await detail(owner, c.id);
  expect(d.balance).toBe("214");
  expect(d.members.reduce((s, m) => s + Number(m.share), 0)).toBe(214);
  expect((await wallet(owner, "ILS")).available_minor).toBe(99600);
  expect((await wallet(owner)).savings_minor).toBe(0);
});
it("automatic circle contributions use the member's default and pause at completion", async () => {
  const sub = await account(),
    c = await circle(sub, 65);
  await rpc("walletwise_set_savings_destination", [sub, "circle", c.id, true]);
  const q = await quote(sub, "circle", c.id, "USD", "USD", 65);
  await buy(sub, "USD", 1235, q);
  expect((await detail(sub, c.id)).balance).toBe("65");
  expect((await detail(sub, c.id)).reached).toBe(true);
  await expect(buy(sub, "USD", 1235, q)).rejects.toThrow(
    /destination unavailable/,
  );
  expect((await wallet(sub)).savings_minor).toBe(0);
});
it("non-members cannot read, contribute, invite, or vote; non-owners cannot initiate withdrawal", async () => {
  const owner = await account(),
    member = await account(),
    outsider = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await expect(detail(outsider, c.id)).rejects.toThrow(/access denied/);
  await expect(contribute(outsider, c.id)).rejects.toThrow(/access denied/);
  await expect(
    command(member, "invite", c.id, { hash: "a".repeat(64) }),
  ).rejects.toThrow(/owner/);
  await expect(proposal(member, c.id)).rejects.toThrow(/owner/);
  const p = await proposal(owner, c.id);
  await expect(approve(outsider, c.id, p.proposalId)).rejects.toThrow(
    /access denied/,
  );
  await expect(approve(member, c.id, p.proposalId)).rejects.toThrow(
    /cannot vote/,
  );
});
it("locks funds until every snapshot contributor approves, including the owner", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id, 300);
  const p = await proposal(owner, c.id, "withdraw", 200);
  await approve(owner, c.id, p.proposalId);
  await expect(
    command(owner, "execute", c.id, { proposalId: p.proposalId }),
  ).rejects.toThrow(/Unanimous/);
  await expect(contribute(member, c.id)).rejects.toThrow(/locked/);
  await expect(proposal(owner, c.id)).rejects.toThrow(/locked/);
  await approve(member, c.id, p.proposalId);
  await command(owner, "execute", c.id, { proposalId: p.proposalId });
  await command(owner, "execute", c.id, { proposalId: p.proposalId });
  const d = await detail(owner, c.id);
  expect(d.balance).toBe("200");
  expect(d.members.map((m) => m.share).sort()).toEqual(["150", "50"]);
  expect((await wallet(owner)).available_minor).toBe(100100);
});
it("one rejection cancels execution; votes cannot be changed or forged", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id);
  const p = await proposal(owner, c.id);
  await approve(member, c.id, p.proposalId, "Reject");
  await expect(approve(member, c.id, p.proposalId)).rejects.toThrow(/closed/);
  await expect(
    command(owner, "execute", c.id, { proposalId: p.proposalId }),
  ).rejects.toThrow(/Unanimous/);
  expect((await detail(owner, c.id)).balance).toBe("200");
});
it("a changed destination requires a new immutable request and new approvals", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id);
  const first = await proposal(owner, c.id);
  await approve(owner, c.id, first.proposalId);
  await command(owner, "cancel", c.id, { proposalId: first.proposalId });
  const recipient = (await detail(owner, c.id)).members.find((m) => !m.you)!;
  const next = await proposal(owner, c.id, "withdraw", 100, recipient.id);
  expect(
    (await detail(owner, c.id)).proposals
      .find((p) => p.id === next.proposalId)
      ?.votes.every((v) => v.decision === null),
  ).toBe(true);
  await expect(
    command(owner, "execute", c.id, { proposalId: next.proposalId }),
  ).rejects.toThrow(/Unanimous/);
});
it("new membership never lowers the snapshot and an outstanding contributor cannot leave", async () => {
  const owner = await account(),
    member = await account(),
    newcomer = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id);
  const p = await proposal(owner, c.id);
  await join(owner, newcomer, c.id);
  expect((await detail(owner, c.id)).proposals[0].votes).toHaveLength(2);
  await expect(command(member, "leave", c.id)).rejects.toThrow(
    /approved return/,
  );
  await command(newcomer, "leave", c.id);
  expect((await detail(owner, c.id)).proposals[0].votes).toHaveLength(2);
  await expect(
    command(newcomer, "execute", c.id, { proposalId: p.proposalId }),
  ).rejects.toThrow(/access denied/);
});
it("unanimously increases completed goals and returns all remaining contributions without deleting history", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner, 200);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id);
  expect((await detail(owner, c.id)).reached).toBe(true);
  const next = await proposal(owner, c.id, "target", 500);
  await approve(owner, c.id, next.proposalId);
  await approve(member, c.id, next.proposalId);
  await command(owner, "execute", c.id, { proposalId: next.proposalId });
  expect((await detail(owner, c.id)).reached).toBe(false);
  const ret = await proposal(owner, c.id, "return_all", 200);
  await approve(owner, c.id, ret.proposalId);
  await approve(member, c.id, ret.proposalId);
  await command(owner, "execute", c.id, { proposalId: ret.proposalId });
  const d = await detail(owner, c.id);
  expect(d.balance).toBe("0");
  expect(d.members.every((m) => m.share === "0")).toBe(true);
  expect(d.entries).toHaveLength(4);
  expect((await wallet(owner)).available_minor).toBe(100000);
  expect((await wallet(member)).available_minor).toBe(100000);
  await command(owner, "archive", c.id);
  expect((await detail(owner, c.id)).archived).toBe(true);
});
it("a merchant purchase refund cannot bypass unanimous approval to withdraw Circle savings", async () => {
  const sub = await account(),
    c = await circle(sub);
  await rpc("walletwise_set_savings_destination", [sub, "circle", c.id, true]);
  const q = await quote(sub, "circle", c.id, "USD", "USD", 65),
    tx = await buy(sub, "USD", 1235, q);
  await rpc("walletwise_goal_refund", [sub, randomUUID(), tx.id]);
  expect((await detail(sub, c.id)).balance).toBe("65");
  expect((await wallet(sub)).available_minor).toBe(99935);
  const data = initialUser();
  const rows = (
    await db.query<StoredTransaction>(
      "select t.*,(select jsonb_agg(jsonb_build_object('currency',l.currency,'account',l.account,'amount_minor',l.amount_minor::text))from ledger_entries l where l.transaction_id=t.id)as ledger_entries from transactions t where auth0_sub=$1",
      [sub],
    )
  ).rows;
  data.ledger = rows.map(mapTransaction);
  data.circleEntries = (
    await rpc<
      { currency: Currency; amount: string; at: string; circleId: string }[]
    >("walletwise_own_circle_ledger", [sub])
  ).map((e) => ({ ...e, amount: Number(e.amount) }));
  const report = buildReport(data, "monthly", Date.now() + 1000).report;
  expect(report.totalSavings?.USD).toBe(65);
  expect(report.circleSavings?.USD).toBe(65);
  expect(report.summaries.find((s) => s.currency === "USD")).toMatchObject({
    spending: 0,
    savings: 65,
  });
  await expect(
    rpc("walletwise_goal_refund", [sub, randomUUID(), tx.id]),
  ).rejects.toThrow(/already refunded/);
});
it("moving personal goal savings into a circle removes the personal allocation exactly once", async () => {
  const sub = await account(),
    g = await goal(sub),
    q = await quote(sub, "goal", g.id, "USD", "USD", 65);
  await buy(sub, "USD", 1235, q);
  const c = await circle(sub);
  const key = randomUUID();
  await contribute(sub, c.id, 65, "USD", 1000000, g.id, key);
  await contribute(sub, c.id, 65, "USD", 1000000, g.id, key);
  expect((await wallet(sub)).savings_minor).toBe(0);
  expect((await detail(sub, c.id)).balance).toBe("65");
  expect(
    await scalar(
      "select sum(amount_minor)::integer from goal_savings_entries where goal_id=$1",
      [g.id],
    ),
  ).toBe(0);
});
it("historical unassigned balances are explicitly assigned through neutral ledger postings", async () => {
  const sub = await account(),
    g = await goal(sub);
  await rpc("walletwise_apply_transaction", [
    sub,
    randomUUID(),
    "legacy",
    "adjustment",
    "Earlier savings",
    "Savings",
    JSON.stringify([
      { currency: "USD", account: "available", amount_minor: -100 },
      { currency: "USD", account: "savings", amount_minor: 100 },
    ]),
    "{}",
  ]);
  const key = randomUUID();
  await rpc("walletwise_assign_historical", [sub, key, g.id, 100]);
  await rpc("walletwise_assign_historical", [sub, key, g.id, 100]);
  expect((await wallet(sub)).savings_minor).toBe(100);
  expect(
    await scalar(
      "select sum(amount_minor)::integer from goal_savings_entries where goal_id=$1",
      [g.id],
    ),
  ).toBe(100);
  expect(
    await scalar(
      "select amount_minor::integer from savings_destination_balances where auth0_sub=$1 and currency='USD' and goal_id is null",
      [sub],
    ),
  ).toBe(0);
});

it("an expired invitation cannot join and expired votes release the reservation without spending", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner),
    invitation = await invite(owner, c.id);
  await db.exec("reset role");
  await db.query(
    "update circle_invitations set expires_at=now()-interval '1 minute' where token_hash=$1",
    [invitation.hash],
  );
  await db.exec("set role service_role");
  await expect(
    command(member, "join", null, { hash: invitation.hash }),
  ).rejects.toThrow(/Invitation/);
  await contribute(owner, c.id);
  const p = await proposal(owner, c.id);
  await db.exec("reset role");
  await db.query(
    "update circle_proposals set expires_at=now()-interval '1 minute' where id=$1",
    [p.proposalId],
  );
  await db.exec("set role service_role");
  expect((await detail(owner, c.id)).proposals[0].status).toBe("Expired");
  await expect(
    command(owner, "execute", c.id, { proposalId: p.proposalId }),
  ).rejects.toThrow(/Unanimous/);
  await contribute(owner, c.id);
  expect((await detail(owner, c.id)).balance).toBe("200");
});
it("failed execution rolls back wallet and group postings and retains a retryable approved snapshot", async () => {
  const owner = await account(),
    c = await circle(owner);
  await contribute(owner, c.id);
  const p = await proposal(owner, c.id);
  await approve(owner, c.id, p.proposalId);
  await db.exec(
    "reset role;create function private.fail_test_transfer()returns trigger language plpgsql as $$begin if new.description='Approved circle withdrawal' then raise exception 'Test transfer unavailable';end if;return new;end$$;create trigger fail_test_transfer before insert on public.transactions for each row execute function private.fail_test_transfer();set role service_role;",
  );
  const before = await wallet(owner);
  await command(owner, "execute", c.id, { proposalId: p.proposalId });
  const failed = await detail(owner, c.id);
  expect(failed.balance).toBe("100");
  expect(failed.proposals[0].status).toBe("Failed");
  expect(failed.proposals[0].error).not.toContain("Test transfer unavailable");
  expect(await wallet(owner)).toEqual(before);
  await db.exec(
    "reset role;drop trigger fail_test_transfer on public.transactions;drop function private.fail_test_transfer();set role service_role;",
  );
  await command(owner, "execute", c.id, { proposalId: p.proposalId });
  expect((await detail(owner, c.id)).balance).toBe("0");
  expect((await wallet(owner)).available_minor).toBe(100000);
});
it("only one competing request reserves funds and owner succession requires all contributor votes", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id);
  const requests = await Promise.allSettled([
    proposal(owner, c.id),
    proposal(owner, c.id),
  ]);
  expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const locked = (await detail(owner, c.id)).proposals[0];
  await command(owner, "cancel", c.id, { proposalId: locked.id });
  const memberId = (await detail(owner, c.id)).members.find((m) => !m.you)!.id;
  const succession = await proposal(owner, c.id, "owner", 0, memberId);
  await approve(owner, c.id, succession.proposalId);
  await expect(
    command(owner, "execute", c.id, { proposalId: succession.proposalId }),
  ).rejects.toThrow(/Unanimous/);
  await approve(member, c.id, succession.proposalId);
  await command(owner, "execute", c.id, { proposalId: succession.proposalId });
  expect((await detail(member, c.id)).owner).toBe(true);
  expect((await detail(owner, c.id)).owner).toBe(false);
});
it("a member can request a return but only a unanimously approved owner proposal moves their share", async () => {
  const owner = await account(),
    member = await account(),
    c = await circle(owner);
  await join(owner, member, c.id);
  await contribute(owner, c.id);
  await contribute(member, c.id, 200);
  await command(member, "request_return", c.id);
  expect((await detail(owner, c.id)).balance).toBe("300");
  const memberId = (await detail(owner, c.id)).members.find((m) => !m.you)!.id,
    p = await proposal(owner, c.id, "return_member", 200, memberId);
  await approve(owner, c.id, p.proposalId);
  await approve(member, c.id, p.proposalId);
  await command(owner, "execute", c.id, { proposalId: p.proposalId });
  expect((await detail(owner, c.id)).balance).toBe("100");
  expect((await wallet(member)).available_minor).toBe(100000);
  await command(member, "leave", c.id);
});
it("replaces one default across all personal/Circle switches without moving existing money", async () => {
  const sub = await account(),
    g1 = await goal(sub),
    g2 = await goal(sub, "JOD", false),
    c1 = await circle(sub),
    c2 = await circle(sub);
  const targets = [
    { kind: "goal", id: g1.id, currency: "USD" },
    { kind: "circle", id: c1.id, currency: "USD" },
    { kind: "goal", id: g2.id, currency: "JOD" },
    { kind: "goal", id: g1.id, currency: "USD" },
    { kind: "circle", id: c1.id, currency: "USD" },
    { kind: "circle", id: c2.id, currency: "USD" },
    { kind: "goal", id: g2.id, currency: "JOD" },
  ] as const;
  const snapshot = async () => ({
    wallets: (
      await db.query(
        "select currency,available_minor,savings_minor from wallets where auth0_sub=$1 order by currency",
        [sub],
      )
    ).rows,
    ledger: await scalar(
      "select count(*) from ledger_entries where auth0_sub=$1",
      [sub],
    ),
    circles: await Promise.all([detail(sub, c1.id), detail(sub, c2.id)]),
  });
  for (const destination of targets) {
    const before = await snapshot();
    expect(
      await rpc("walletwise_set_savings_destination", [
        sub,
        destination.kind,
        destination.id,
        true,
      ]),
    ).toEqual(destination);
    expect(await snapshot()).toEqual(before);
    const choices = await rpc<{
      destination: unknown;
      options: { id: string }[];
    }>("walletwise_savings_options", [sub]);
    expect(choices.destination).toEqual(destination);
    expect(choices.options.map((o) => o.id).sort()).toEqual(
      [g1.id, g2.id, c1.id, c2.id].sort(),
    );
    const rate = destination.currency === "USD" ? 285714 : 200000;
    const q = await quote(
      sub,
      destination.kind,
      destination.id,
      "ILS",
      destination.currency,
      400,
      rate,
    );
    const transaction = await buy(sub, "ILS", 1600, q);
    expect(
      transaction.metadata[destination.kind === "goal" ? "goalId" : "circleId"],
    ).toBe(destination.id);
    expect(
      (transaction.metadata.saving as { target_currency: string })
        .target_currency,
    ).toBe(destination.currency);
  }
});
it("rejects archived, completed and inaccessible Circles without replacing a valid personal default", async () => {
  const sub = await account(),
    g = await goal(sub),
    archived = await circle(sub),
    completed = await circle(sub, 100),
    outsider = await account(),
    privateCircle = await circle(outsider);
  await command(sub, "archive", archived.id);
  await contribute(sub, completed.id, 100);
  const before = await wallet(sub);
  for (const invalid of [archived, completed, privateCircle]) {
    await expect(
      rpc("walletwise_set_savings_destination", [
        sub,
        "circle",
        invalid.id,
        true,
      ]),
    ).rejects.toThrow(/destination unavailable/);
  }
  const choices = await rpc<{
    destination: { id: string };
    options: { id: string }[];
  }>("walletwise_savings_options", [sub]);
  expect(choices.destination.id).toBe(g.id);
  expect(choices.options.map((o) => o.id)).toEqual([g.id]);
  expect(await wallet(sub)).toEqual(before);
  expect((await detail(sub, completed.id)).balance).toBe("100");
});
it("RLS and RPC permissions keep unjoined circles and private wallet data inaccessible", async () => {
  const owner = await account(),
    outsider = await account(),
    c = await circle(owner);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: outsider, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
  expect(
    (await db.query("select id from savings_circles where id=$1", [c.id])).rows,
  ).toEqual([]);
  expect(
    (
      await db.query("select auth0_sub from wallets where auth0_sub=$1", [
        owner,
      ])
    ).rows,
  ).toEqual([]);
  await expect(
    rpc("walletwise_circle_command", [
      owner,
      "archive",
      c.id,
      randomUUID(),
      "{}",
    ]),
  ).rejects.toThrow(/permission denied/);
  await expect(db.query("select * from circle_invitations")).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    rpc("walletwise_invitation_status", [owner, "a".repeat(64)]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    rpc("walletwise_join_circle", [owner, "a".repeat(64), randomUUID()]),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role;set role service_role");
});

it("records all crossed milestones once and exposes a private ordered timeline", async () => {
  const sub = await account(),
    outsider = await account(),
    c = await circle(sub, 10000);
  await contribute(sub, c.id, 8000);
  let d = await detail(sub, c.id);
  expect(d.balance).toBe("8000");
  expect(
    d.activity
      .filter((e) => e.event === "milestone")
      .map((e) => e.details.threshold)
      .sort(),
  ).toEqual([25, 50, 75]);
  await contribute(sub, c.id, 1000);
  d = await detail(sub, c.id);
  expect(d.activity.filter((e) => e.event === "milestone")).toHaveLength(3);
  const timeline = await rpc<{ id: string; at: string; event: string }[]>(
    "walletwise_circle_timeline",
    [sub, c.id],
  );
  expect(timeline.some((e) => e.event === "contribution")).toBe(true);
  expect(timeline.some((e) => e.event === "milestone")).toBe(true);
  expect(timeline.map((e) => e.at)).toEqual(
    timeline
      .map((e) => e.at)
      .sort()
      .reverse(),
  );
  await expect(
    rpc("walletwise_circle_timeline", [outsider, c.id]),
  ).rejects.toThrow(/access denied/i);
  const first = timeline[0];
  const tail = await rpc<{ id: string }[]>("walletwise_circle_timeline", [
    sub,
    c.id,
    first.at,
    first.id,
  ]);
  expect(tail.some((e) => e.id === first.id)).toBe(false);
});
it("does not award old thresholds after a unanimous return and new contributions", async () => {
  const sub = await account(),
    c = await circle(sub, 10000);
  await contribute(sub, c.id, 6000);
  const p = await command(sub, "propose", c.id, {
    kind: "return_all",
    amount: 6000,
    currency: "USD",
    reason: "Return",
    destination: null,
  });
  await command(sub, "vote", c.id, {
    proposalId: p.proposalId,
    decision: "Approve",
  });
  await command(sub, "execute", c.id, { proposalId: p.proposalId });
  await contribute(sub, c.id, 6000);
  const d = await detail(sub, c.id);
  expect(d.activity.filter((e) => e.event === "milestone")).toHaveLength(2);
});
it("uses coherent owned coach totals and excludes reassignments from new saving pace", async () => {
  const sub = await account(),
    other = await account(),
    g = await goal(sub);
  await buy(sub, "USD", 1235, await quote(sub, "goal", g.id, "USD", "USD", 65));
  const input = await rpc<import("../shared/coach").CoachInput>(
    "walletwise_coach",
    [sub, sub],
  );
  expect(input.goals.find((v) => v.id === g.id)?.saved).toBeGreaterThan(0);
  expect(input.samples.some((v) => v.goalId === g.id)).toBe(true);
  expect(input.available.USD).toBeGreaterThan(0);
  expect(await rpc("walletwise_coach", [other, sub])).toBeNull();
  const dashboard = await rpc<{
    dashboard: {
      dailySpending: { amount: string; gross: string; refunds: string }[];
    };
  }>("walletwise_dashboard", [sub, sub, "UTC"]);
  const row = dashboard.dashboard.dailySpending[0];
  expect(Number(row.amount)).toBe(Number(row.gross) - Number(row.refunds));
});
it("rejects direct client access to the new privileged functions and milestone records", async () => {
  await db.exec("reset role;set role authenticated");
  await expect(rpc("walletwise_coach", ["fake", "fake"])).rejects.toThrow(
    /permission denied/,
  );
  await expect(db.query("select * from circle_milestones")).rejects.toThrow(
    /permission denied/,
  );
});

it("validates full savings settings and ledger revisions before accepting a reviewed rule", async () => {
  const sub = await account(),
    g = await goal(sub);
  const snapshot = () =>
    scalar<{ increments: object; caps: object; destination: object }>(
      "select jsonb_build_object('increments',(select jsonb_object_agg(currency,increment_minor)from savings_rules where auth0_sub=$1),'caps',(select jsonb_object_agg(currency,cap_minor)from savings_rules where auth0_sub=$1),'destination',wallet_preferences->'savingsDestination') from profiles where auth0_sub=$1",
      [sub],
    );
  const settings = await snapshot();
  const revision = await scalar<string>(
    "select id::text from transactions where auth0_sub=$1 order by occurred_at desc,id desc limit 1",
    [sub],
  );
  const current = await scalar<number>(
    "select increment_minor::int from savings_rules where auth0_sub=$1 and currency='USD'",
    [sub],
  );
  const cap = await scalar<number>(
    "select cap_minor::int from savings_rules where auth0_sub=$1 and currency='USD'",
    [sub],
  );
  const other = await goal(sub, "USD", false);
  await rpc("walletwise_set_savings_destination", [
    sub,
    "goal",
    other.id,
    true,
  ]);
  await expect(
    rpc("walletwise_accept_reviewed_rule", [
      sub,
      "USD",
      current,
      cap,
      current * 2,
      revision,
      JSON.stringify(settings),
    ]),
  ).rejects.toThrow(/settings changed/i);
  await rpc("walletwise_set_savings_destination", [sub, "goal", g.id, true]);
  await rpc("walletwise_accept_reviewed_rule", [
    sub,
    "USD",
    current,
    cap,
    current * 2,
    revision,
    JSON.stringify(settings),
  ]);
  expect(
    await scalar<number>(
      "select increment_minor::int from savings_rules where auth0_sub=$1 and currency='USD'",
      [sub],
    ),
  ).toBe(current * 2);
  const fresh = await snapshot();
  await buy(sub, "USD", 100, null, true);
  await expect(
    rpc("walletwise_accept_reviewed_rule", [
      sub,
      "USD",
      current * 2,
      cap,
      current * 4,
      revision,
      JSON.stringify(fresh),
    ]),
  ).rejects.toThrow(/settings changed/i);
});
it("retains signed refund spending when refunds exceed this month's purchases", async () => {
  const sub = await account();
  await goal(sub);
  const tx = await buy(
    sub,
    "USD",
    1235,
    await quote(
      sub,
      "goal",
      (
        await rpc<import("../shared/coach").CoachInput>("walletwise_coach", [
          sub,
          sub,
        ])
      ).goals[0].id,
      "USD",
      "USD",
      65,
    ),
  );
  await db.exec("reset role");
  await db.query(
    "update transactions set occurred_at=date_trunc('month',now())-interval '1 day' where id=$1",
    [tx.id],
  );
  await db.exec("set role service_role");
  await rpc("walletwise_goal_refund", [sub, randomUUID(), tx.id]);
  const d = await rpc<{
    dashboard: {
      dailySpending: {
        day: string;
        amount: string;
        gross: string;
        refunds: string;
      }[];
    };
  }>("walletwise_dashboard", [sub, sub, "UTC"]);
  const month = new Date().toISOString().slice(0, 7),
    rows = d.dashboard.dailySpending.filter((r) => r.day.startsWith(month));
  expect(rows.reduce((n, r) => n + Number(r.amount), 0)).toBe(-1235);
  expect(rows.reduce((n, r) => n + Number(r.refunds), 0)).toBe(1235);
});
