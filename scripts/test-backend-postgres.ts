import { initialUser } from "../shared/ledger.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import type { Snapshot } from "../shared/types";

// Never read hosted credentials or connect to an operator-supplied database.
process.env.WALLETWISE_LOAD_ENV = "false";
process.env.SUPABASE_ENABLED = "false";
const { SupabaseBackendStorage, withGuards } =
  await import("../server/backend-storage");
const probe = createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((r) => probe.close(() => r()));
const directory = mkdtempSync(join(tmpdir(), "dream-piggy-postgres-"));
const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: "postgres",
  password: randomUUID(),
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  postgresFlags: ["-h", "127.0.0.1", "-c", "max_connections=40"],
  onLog: () => {},
  onError: () => {},
});
const clients: Client[] = [];
let passed = 0;
async function test(name: string, work: () => Promise<void>) {
  await work();
  passed++;
  console.log(`PASS ${name}`);
}
const definitions: Record<string, [string, string][]> = {
  walletwise_backend_read: [["p_id", "text"]],
  walletwise_backend_cas: [
    ["p_id", "text"],
    ["p_version", "bigint"],
    ["p_value", "jsonb"],
    ["p_expires_at", "timestamptz"],
    ["p_guards", "jsonb"],
  ],
  walletwise_consume_limit: [
    ["p_scope", "text"],
    ["p_identity", "text"],
    ["p_limit", "integer"],
    ["p_window_ms", "integer"],
  ],
  walletwise_backend_lease: [
    ["p_action", "text"],
    ["p_scope", "text"],
    ["p_owner", "uuid"],
    ["p_slots", "integer"],
    ["p_duration_ms", "integer"],
    ["p_generation", "bigint"],
  ],
  walletwise_store_observation: [
    ["p_provider", "text"],
    ["p_snapshot", "jsonb"],
    ["p_guards", "jsonb"],
  ],
  walletwise_backend_account_cas: [
    ["p_uid", "text"],
    ["p_sub", "text"],
    ["p_version", "bigint"],
    ["p_state", "jsonb"],
    ["p_guards", "jsonb"],
  ],
  walletwise_cleanup_backend: [["p_batch", "integer"]],
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
try {
  await postgres.initialise();
  await postgres.start();
  const admin = postgres.getPgClient();
  clients.push(admin);
  await admin.connect();
  await admin.query(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt()returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$",
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await admin.query(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  const adapters = await Promise.all(
    Array.from({ length: 16 }, async () => {
      const client = postgres.getPgClient();
      clients.push(client);
      await client.connect();
      await client.query("set role service_role");
      return new SupabaseBackendStorage(async (name, args) => {
        const definition = definitions[name];
        assert(definition, "Unexpected RPC");
        try {
          const values = definition.map(([key, type]) =>
            type === "jsonb" ? JSON.stringify(args[key]) : args[key],
          );
          const result = await client.query(
            `select public.${name}(${definition.map(([, type], i) => `$${i + 1}::${type}`).join(",")}) as value`,
            values,
          );
          return { data: result.rows[0].value, error: null };
        } catch (error) {
          return { data: null, error };
        }
      });
    }),
  );
  const a = adapters[0],
    b = adapters[1];
  console.log(
    `PostgreSQL ${(await admin.query("show server_version")).rows[0].server_version}; ${adapters.length} independent connections`,
  );
  await test("service-only RPCs, internal RLS and restricted search_path", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`set role ${role}`);
      await assert.rejects(
        admin.query("select * from private.backend_limits"),
        /permission denied/,
      );
      if (role !== "service_role")
        for (const [name, def] of Object.entries(definitions)) {
          const oid = `public.${name}(${def.map(([, type]) => type).join(",")})`;
          const row = (
            await admin.query(
              "select has_function_privilege(current_user,$1,'execute') allowed",
              [oid],
            )
          ).rows[0];
          assert.equal(row.allowed, false);
        }
    }
    await admin.query("reset role");
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any($1::text[]) and c.relrowsecurity",
          [
            [
              "backend_records",
              "backend_limits",
              "backend_lease_scopes",
              "backend_leases",
            ],
          ],
        )
      ).rows[0].n,
      4,
    );
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) and p.prosecdef and p.proconfig @> array['search_path=\"\"']",
          [Object.keys(definitions)],
        )
      ).rows[0].n,
      Object.keys(definitions).length,
    );
  });
  await test("atomic limit under concurrent independent instances and identity isolation", async () => {
    const results = await Promise.all(
      adapters.map((s) => s.consume("concurrent", hash("alice"), 3, 60000)),
    );
    assert.equal(results.filter((r) => r.allowed).length, 3);
    assert.equal(
      (await b.consume("concurrent", hash("bob"), 3, 60000)).allowed,
      true,
    );
  });
  await test("fixed window expiry and Retry-After", async () => {
    assert.equal(
      (await a.consume("expiry", hash("alice"), 1, 80)).allowed,
      true,
    );
    const denied = await b.consume("expiry", hash("alice"), 1, 80);
    assert.equal(denied.allowed, false);
    assert(denied.retryAfter >= 1);
    await delay(100);
    assert.equal(
      (await b.consume("expiry", hash("alice"), 1, 80)).allowed,
      true,
    );
  });
  await test("database failure never bypasses rate enforcement or leaks SQL errors", async () => {
    const unavailable = new SupabaseBackendStorage(async () => ({
      data: null,
      error: { message: "private database password" },
    }));
    await assert.rejects(
      unavailable.consume("x", hash("x"), 1, 1000),
      (e: Error) =>
        !e.message.includes("password") && /unavailable/.test(e.message),
    );
    await assert.rejects(unavailable.read("cache_private"));
  });
  await test("JSON CAS preserves concurrent writes across real sessions", async () => {
    await Promise.all(
      adapters.slice(0, 8).map((s) =>
        s.update(
          "counter",
          () => ({ n: 0 }),
          (v) => ++v.n,
        ),
      ),
    );
    assert.deepEqual(await a.read("counter"), { n: 8 });
  });
  await test("cache TTL, user/provider isolation and stale reads", async () => {
    for (const id of ["cache_alice_pma", "cache_bob_pma", "cache_alice_twelve"])
      assert(
        await a.cas(
          id,
          null,
          { result: id },
          new Date(Date.now() + 100).toISOString(),
        ),
      );
    assert.notDeepEqual(
      await b.read("cache_alice_pma"),
      await b.read("cache_bob_pma"),
    );
    assert.notDeepEqual(
      await b.read("cache_alice_pma"),
      await b.read("cache_alice_twelve"),
    );
    await delay(120);
    assert.equal(await b.read("cache_alice_pma"), undefined);
  });
  await test("lease contention, ownership-safe renewal/release and crash recovery", async () => {
    const owner = randomUUID();
    const l = await a.lease("acquire", "refresh", owner, 1, 100);
    assert(l.acquired);
    assert.equal(
      (await b.lease("acquire", "refresh", randomUUID(), 1, 100)).acquired,
      false,
    );
    assert.equal(
      (await b.lease("release", "refresh", randomUUID(), 1, 100, l.generation))
        .acquired,
      false,
    );
    assert.equal(
      (await a.lease("renew", "refresh", owner, 1, 100, l.generation)).acquired,
      true,
    );
    await delay(130);
    const successor = await b.lease(
      "acquire",
      "refresh",
      randomUUID(),
      1,
      1000,
    );
    assert(successor.acquired);
    assert(successor.generation > l.generation);
    assert.equal(
      (await a.lease("renew", "refresh", owner, 1, 100, l.generation)).acquired,
      false,
    );
    const released = await a.lease(
      "release",
      "refresh",
      owner,
      1,
      100,
      l.generation,
    );
    assert(!released.acquired);
    assert.equal(released.released, false);
    await assert.rejects(
      withGuards(l, () => a.cas("stale_publish", null, { invalid: true })),
    );
    assert.equal(await a.read("stale_publish"), undefined);
    assert(
      await withGuards(successor, () =>
        b.cas("stale_publish", null, { valid: true }),
      ),
    );
    await b.lease(
      "release",
      "refresh",
      successor.owner,
      1,
      1000,
      successor.generation,
    );
  });
  await test("global AI concurrency and failure/timeout release across instances", async () => {
    const owners = adapters.map(() => randomUUID());
    const results = await Promise.all(
      adapters.map((s, i) => s.lease("acquire", "gemini", owners[i], 3, 120)),
    );
    assert.equal(results.filter((r) => r.acquired).length, 3);
    for (const [i, l] of results.entries())
      if (l.acquired)
        await adapters[i].lease(
          "release",
          "gemini",
          owners[i],
          3,
          120,
          l.generation,
        );
    const l = await a.lease("acquire", "gemini", randomUUID(), 3, 50);
    assert(l.acquired);
    await delay(80);
    const recovered = await b.lease("acquire", "gemini", randomUUID(), 1, 1000);
    assert(recovered.acquired);
  });
  await test("the production lease runner releases on provider failure, cancellation and timeout", async () => {
    for (const failure of [
      new Error("provider failure"),
      new DOMException("cancelled", "AbortError"),
      new Error("provider timeout"),
    ]) {
      await assert.rejects(
        a.withLease("runner", 1, async () => {
          await delay(5);
          throw failure;
        }),
        (e: Error) => e === failure,
      );
      assert.equal(
        await b.withLease("runner", 1, async () => "released"),
        "released",
      );
    }
    await a.withLease(
      "renew-runner",
      1,
      async (l) => {
        await delay(80);
        await l!.renew();
        await delay(80);
        assert(await a.cas("renewed-publication", null, { valid: true }));
      },
      150,
    );
    await a.withLease("busy-runner", 1, async () => {
      await assert.rejects(
        b.withLease("busy-runner", 1, async () => null),
        (error: { status?: number; retryAfter?: number }) =>
          error.status === 429 && error.retryAfter === 3,
      );
    });
  });
  const snapshot: Snapshot = {
    id: "migration-observation",
    fetchedAt: "2026-11-01T10:00:00.123Z",
    publishedAt: null,
    source: "https://wcur.pma.ps/webtools/currency/embed",
    quotes: [],
    ils: { ILS: 1000000, USD: 3500123, JOD: 5000456 },
  };
  await test("rate history uses existing table, exact precision/time and duplicate protection", async () => {
    await Promise.all(adapters.map((s) => s.observation("pma", snapshot)));
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from forex_snapshots where id=$1",
          [snapshot.id],
        )
      ).rows[0].n,
      1,
    );
    const row = (
      await admin.query(
        "select snapshot,observed_at from forex_snapshots where id=$1",
        [snapshot.id],
      )
    ).rows[0];
    assert.deepEqual(row.snapshot, snapshot);
    assert.equal(row.observed_at.toISOString(), snapshot.fetchedAt);
    assert.equal(
      (await admin.query("select * from forex_history('2026-01-01',60)"))
        .rowCount,
      0,
    );
    await assert.rejects(
      b.observation("pma", { ...snapshot, ils: { ...snapshot.ils, USD: 1 } }),
    );
    await assert.rejects(b.observation("pma", {} as typeof snapshot));
    await b.observation("twelve", {
      ...snapshot,
      id: "twelve-observation",
      publishedAt: "2026-11-01T09:59:00.001Z",
    });
    assert.equal(
      (await admin.query("select * from forex_history('2026-01-01',60)"))
        .rowCount,
      1,
    );
  });
  await test("expired workers cannot publish observations or auxiliary account state", async () => {
    const l = await a.lease("acquire", "expired-history", randomUUID(), 1, 20);
    assert(l.acquired);
    await delay(40);
    await assert.rejects(
      withGuards(l, () =>
        a.observation("pma", { ...snapshot, id: "must-not-publish" }),
      ),
    );
    const { initialUser } = await import("../shared/ledger");
    await assert.rejects(
      withGuards(l, () =>
        a.accountCas("uid", "auth0|missing", null, initialUser()),
      ),
    );
  });
  await test("fenced auxiliary account CAS preserves ownership and versions", async () => {
    const { initialUser } = await import("../shared/ledger");
    const sub = "auth0|guarded-alerts";
    await admin.query("select walletwise_initialize_user($1)", [sub]);
    const state = { ...initialUser(), auth0Sub: sub };
    await a.withLease("alerts-cas", 1, async () => {
      assert(await a.accountCas("guarded-uid", sub, null, state));
      assert.equal(
        await b.accountCas("guarded-uid", "auth0|other", 0, state),
        false,
      );
      assert(
        await a.accountCas("guarded-uid", sub, 0, {
          ...state,
          notices: [
            {
              id: "notice",
              at: new Date().toISOString(),
              title: "Test",
              body: "Fixture",
              read: false,
            },
          ],
        }),
      );
      assert.equal(await b.accountCas("guarded-uid", sub, 0, state), false);
    });
    const saved = (
      await admin.query(
        "select version,state from account_state where user_id='guarded-uid'",
      )
    ).rows[0];
    assert.equal(Number(saved.version), 1);
    assert.equal(saved.state.notices.length, 1);
  });
  await test("bounded cleanup keeps durable records and prevents version/fence ABA", async () => {
    const previous = await a.record("cache_alice_pma");
    assert(previous);
    assert((await a.cleanup(500)) > 0);
    assert(await a.cas("cache_alice_pma", null, { fresh: true }));
    assert.equal(
      await a.cas("cache_alice_pma", previous.version, { stale: true }),
      false,
    );
    assert.deepEqual(await a.read("counter"), { n: 8 });
    assert.equal(
      (await admin.query("select count(*)::int n from forex_snapshots")).rows[0]
        .n,
      2,
    );
  });
  await test("the import utility dry-run, idempotent import and conflict reconciliation use real SQL", async () => {
    const { planImport, digest, reconcileLegacy } =
      await import("./legacy-storage");
    const source = {
      format: 1,
      source: "fixture",
      exportedAt: new Date().toISOString(),
      records: [
        { id: "twelve_status", value: { dayCredits: 2 } },
        { id: "rates", value: [{ ...snapshot, id: "imported-rate" }] },
      ].map((r) => ({ ...r, hash: digest(r.value) })),
    };
    const plan = planImport(source);
    const destination = {
      read: (id: string) => a.read(id),
      cas: (id: string, version: null, value: unknown) =>
        a.cas(id, version, value),
      observation: (provider: "pma" | "twelve", value: Snapshot) =>
        a.observation(provider, value),
      readObservation: async (id: string) =>
        (
          await admin.query(
            "select provider,snapshot from forex_snapshots where id=$1",
            [id],
          )
        ).rows[0] ?? null,
    };
    assert.equal((await reconcileLegacy(plan, destination, false)).missing, 2);
    assert.equal((await reconcileLegacy(plan, destination, true)).inserted, 2);
    const replay = await reconcileLegacy(plan, destination, true);
    assert.equal(replay.inserted, 0);
    assert.equal(replay.matched, 2);
    const modified = planImport({
      ...source,
      records: [
        {
          id: "twelve_status",
          value: { dayCredits: 0 },
          hash: digest({ dayCredits: 0 }),
        },
      ],
    });
    assert.equal(
      (await reconcileLegacy(modified, destination, true)).conflicts.length,
      1,
    );
    assert.deepEqual(await a.read("twelve_status"), { dayCredits: 2 });
  });
  await test("concurrent Circle contributions award each milestone once with exact balances", async () => {
    const sub = `auth0|milestones-${randomUUID()}`;
    await admin.query("select walletwise_initialize_user($1)", [sub]);
    await admin.query(
      "insert into account_state(user_id,auth0_sub,state)values($1,$1,$2::jsonb)",
      [sub, JSON.stringify(initialUser())],
    );
    await admin.query(
      "select walletwise_apply_transaction($1,$2,$3,'adjustment','Test funding','Funding',$4::jsonb,'{}'::jsonb)",
      [
        sub,
        randomUUID(),
        "fund",
        JSON.stringify([
          { currency: "USD", account: "available", amount_minor: 10000 },
          { currency: "USD", account: "external", amount_minor: -10000 },
        ]),
      ],
    );
    const c = (
      await admin.query(
        "select walletwise_circle_command($1,'create',null,$2,$3::jsonb) c",
        [
          sub,
          randomUUID(),
          JSON.stringify({ name: "Concurrent", currency: "USD", target: 800 }),
        ],
      )
    ).rows[0].c.id;
    const quotes: string[] = [];
    for (let i = 0; i < 8; i++)
      quotes.push(
        (
          await admin.query(
            "insert into savings_quotes(auth0_sub,destination_kind,destination_id,source_currency,source_minor,target_currency,target_minor,rate_units,source,observed_at,expires_at,snapshot_id)values($1,'circle',$2,'USD',100,'USD',100,1000000,'Test',now(),now()+interval '2 minutes','test')returning id",
            [sub, c],
          )
        ).rows[0].id,
      );
    await Promise.all(
      quotes.map((q, i) =>
        clients[i + 1].query(
          "select walletwise_circle_contribute($1,$2,$3,$4,'USD',100,$5,null)",
          [sub, c, randomUUID(), `concurrent:${i}`, q],
        ),
      ),
    );
    assert.equal(
      (
        await admin.query(
          "select balance_minor from savings_circles where id=$1",
          [c],
        )
      ).rows[0].balance_minor,
      "800",
    );
    assert.deepEqual(
      (
        await admin.query(
          "select threshold from circle_milestones where circle_id=$1 order by threshold",
          [c],
        )
      ).rows.map((r) => r.threshold),
      [25, 50, 75, 100],
    );
    assert.equal(
      (
        await admin.query(
          "select count(*) n from circle_activity where circle_id=$1 and event='milestone'",
          [c],
        )
      ).rows[0].n,
      "4",
    );
    assert.equal(
      (
        await admin.query(
          "select available_minor from wallets where auth0_sub=$1 and currency='USD'",
          [sub],
        )
      ).rows[0].available_minor,
      "9200",
    );
  });
  console.log(
    JSON.stringify({
      passed,
      realPostgres: true,
      independentConnections: adapters.length,
      hostedChanges: false,
    }),
  );
} finally {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  await postgres.stop();
  // Verify before recursive deletion: only the uniquely created OS-temp cluster.
  const target = resolve(directory),
    rel = relative(resolve(tmpdir()), target);
  if (
    !rel.startsWith("dream-piggy-postgres-") ||
    rel.includes("..") ||
    target === resolve(tmpdir())
  ) {
    console.error("Unsafe test cleanup target; directory retained");
    process.exitCode = 1;
  } else rmSync(target, { recursive: true, force: true });
}
