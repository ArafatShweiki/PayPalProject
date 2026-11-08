import { buildCoach, type CoachInput } from "../../shared/coach";
// Browser integration fixture: real PostgreSQL migrations and financial RPCs,
// test identities and explicit test exchange rates. Never imported by the app.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { initialUser } from "../../shared/ledger";
import { minor, roundUp, convert, type Currency } from "../../shared/money";
import { mapTransaction } from "../../server/database-state";
import type { State } from "../../shared/types";
import type { StoredTransaction } from "../../server/supabase";
import { loadingResponse } from "./loading";
import type { Route } from "@playwright/test";
export class CircleLedgerFixture {
  db = new PGlite();
  states = new Map<string, State>();
  async scalar<T = unknown>(sql: string, args: unknown[] = []): Promise<T> {
    return Object.values(
      (await this.db.query(sql, args)).rows[0] as object,
    )[0] as T;
  }
  async rpc<T = unknown>(name: string, args: unknown[]): Promise<T> {
    return this.scalar(
      `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")})`,
      args,
    );
  }
  async initialize() {
    await this.db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.jwt()returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;",
    );
    for (const f of readdirSync("supabase/migrations").sort())
      await this.db.exec(
        readFileSync(`supabase/migrations/${f}`, "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    await this.db.exec("set role service_role");
  }
  async account(name: string) {
    const sub = `auth0|${name}`;
    await this.rpc("walletwise_initialize_user", [sub]);
    await this.rpc("walletwise_complete_onboarding", [
      sub,
      name,
      null,
      false,
      "ILS",
      false,
      false,
    ]);
    await this.db.query(
      "insert into account_state(user_id,auth0_sub,state)values($1,$1,$2::jsonb)",
      [sub, JSON.stringify(initialUser())],
    );
    for (const currency of ["ILS", "USD", "JOD"])
      await this.rpc("walletwise_apply_transaction", [
        sub,
        randomUUID(),
        "fund",
        "adjustment",
        "Fixture funds",
        "Funding",
        JSON.stringify([
          { currency, account: "available", amount_minor: 100000 },
          { currency, account: "external", amount_minor: -100000 },
        ]),
        "{}",
      ]);
    this.states.set(sub, await this.read(sub));
    return sub;
  }
  async read(sub: string) {
    const data = await this.scalar<State>(
      "select state from account_state where auth0_sub=$1",
      [sub],
    );
    const profile = await this.scalar<{
      wallet_preferences: State["preferences"];
      savings_enabled: boolean;
      full_name: string;
    }>("select to_jsonb(p) from profiles p where auth0_sub=$1", [sub]);
    data.preferences = {
      ...data.preferences,
      ...profile.wallet_preferences,
      name: profile.full_name,
      savings: profile.savings_enabled ? "enabled" : "disabled",
    };
    const rows = (
      await this.db.query<StoredTransaction>(
        "select t.*,(select jsonb_agg(jsonb_build_object('currency',l.currency,'account',l.account,'amount_minor',l.amount_minor::text)) from ledger_entries l where l.transaction_id=t.id)as ledger_entries from transactions t where auth0_sub=$1 order by occurred_at,id",
        [sub],
      )
    ).rows;
    data.ledger = rows.map(mapTransaction);
    data.balances = { ILS: 0, USD: 0, JOD: 0 };
    data.savingsBalances = { ILS: 0, USD: 0, JOD: 0 };
    const wallets = (
      await this.db.query<{
        currency: Currency;
        available_minor: number;
        savings_minor: number;
      }>(
        "select currency,available_minor::integer,savings_minor::integer from wallets where auth0_sub=$1",
        [sub],
      )
    ).rows;
    for (const w of wallets) {
      data.balances[w.currency] = w.available_minor;
      data.savingsBalances[w.currency] = w.savings_minor;
    }
    data.snapshots = [];
    data.authMode = "auth0";
    data.capabilities = { firebase: false, paypal: false, gemini: false };
    data.dashboard = (
      await this.rpc<{ dashboard: State["dashboard"] }>(
        "walletwise_dashboard",
        [sub, sub, "UTC"],
      )
    ).dashboard;
    return data;
  }
  async refresh() {
    for (const [sub, state] of this.states)
      Object.assign(state, await this.read(sub));
  }
  async quote(
    sub: string,
    currency: Currency,
    value: number,
    destination: { kind: string; id: string },
  ) {
    const opts = await this.rpc<{
      options: { id: string; kind: string; currency: Currency }[];
    }>("walletwise_savings_options", [sub]);
    const dest = opts.options.find(
      (o) => o.id === destination.id && o.kind === destination.kind,
    );
    if (!dest) throw new Error("Choose a savings goal before saving.");
    const rate =
      currency === dest.currency
        ? 1000000
        : currency === "ILS" && dest.currency === "USD"
          ? 285714
          : currency === "JOD" && dest.currency === "USD"
            ? 1400000
            : 1000000;
    return this.scalar<Record<string, unknown>>(
      "insert into savings_quotes(auth0_sub,destination_kind,destination_id,source_currency,source_minor,target_currency,target_minor,rate_units,source,observed_at,expires_at,snapshot_id)values($1,$2,$3,$4,$5,$6,$7,$8,'Explicit E2E fixture',now(),now()+interval '2 minutes','test-only')returning to_jsonb(savings_quotes)-'auth0_sub'",
      [
        sub,
        destination.kind,
        destination.id,
        currency,
        value,
        dest.currency,
        convert(value, currency, dest.currency, rate),
        rate,
      ],
    );
  }
  async route(sub: string, route: Route) {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.slice(4),
      body = req.method() === "GET" ? {} : req.postDataJSON() || {};
    let result: unknown;
    try {
      const state = this.states.get(sub)!;
      if (path === "/config") result = { auth0: null };
      else if (
        path === "/bootstrap" ||
        path.startsWith("/dashboard") ||
        path.startsWith("/activity")
      )
        result = loadingResponse(path + url.search, state);
      else if (path === "/rates/live")
        result = {
          snapshots: [],
          status: {
            provider: "Unknown",
            connection: "unavailable",
            staleMs: 60000,
          },
        };
      else if (path === "/savings/options")
        result = await this.rpc("walletwise_savings_options", [sub]);
      else if (path === "/savings/destination")
        result = await this.rpc("walletwise_set_savings_destination", [
          sub,
          body.kind,
          body.id,
          body.enable,
        ]);
      else if (path === "/preferences")
        result = await this.rpc("walletwise_patch_preferences", [
          sub,
          JSON.stringify(body),
        ]);
      else if (
        path.startsWith("/goals/") &&
        route.request().method() === "DELETE"
      )
        result = await this.rpc("walletwise_delete_savings_goal", [
          sub,
          sub,
          path.slice(7),
        ]);
      else if (path === "/goals")
        result = await this.rpc("walletwise_create_savings_goal", [
          sub,
          sub,
          body.requestId,
          JSON.stringify(body),
          JSON.stringify({
            name: body.name,
            currency: body.currency,
            target: minor(body.amount, body.currency),
            targetDate: body.targetDate,
          }),
          body.makeDefault,
        ]);
      else if (path === "/savings/preview") {
        const saved = body.purchase
          ? state.preferences.savings === "enabled"
            ? roundUp(
                minor(body.amount, body.currency),
                state.preferences.increments[body.currency as Currency],
                state.preferences.caps[body.currency as Currency],
              )
            : 0
          : minor(body.amount, body.currency);
        result = saved
          ? {
              saved,
              quote: await this.quote(
                sub,
                body.currency,
                saved,
                body.destination || state.preferences.savingsDestination,
              ),
            }
          : { saved: 0, quote: null };
      } else if (path === "/purchases")
        result = await this.rpc("walletwise_goal_purchase", [
          sub,
          body.requestId,
          JSON.stringify({ ...body, quoteId: undefined }),
          body.currency,
          minor(body.amount, body.currency),
          body.description,
          body.category,
          body.quoteId ?? null,
          body.skipSavings ?? false,
        ]);
      else if (path === "/refunds")
        result = await this.rpc("walletwise_goal_refund", [
          sub,
          body.requestId,
          body.id,
        ]);
      else if (path === "/savings/coach")
        result = buildCoach(
          await this.rpc<CoachInput>("walletwise_coach", [sub, sub]),
        );
      else if (path === "/guide") result = {};
      else if (path.endsWith("/timeline")) {
        const rows = await this.rpc<unknown[]>("walletwise_circle_timeline", [
          sub,
          path.split("/")[2],
          url.searchParams.get("before"),
          url.searchParams.get("id"),
        ]);
        result = { events: rows.slice(0, 25), more: rows.length > 25 };
      } else if (path === "/circles" && req.method() === "GET")
        result = await this.rpc("walletwise_circles", [sub]);
      else if (path === "/circles")
        result = await this.rpc("walletwise_circle_command", [
          sub,
          "create",
          null,
          body.requestId,
          JSON.stringify({
            ...body,
            target: minor(body.amount, body.currency),
          }),
        ]);
      else if (path.startsWith("/circles/invite/"))
        result = await this.rpc("walletwise_invitation_preview", [
          createHash("sha256").update(path.split("/").at(-1)!).digest("hex"),
        ]);
      else if (path.startsWith("/circles/invitations/"))
        result = await this.rpc("walletwise_invitation_status", [
          sub,
          createHash("sha256").update(path.split("/").at(-1)!).digest("hex"),
        ]);
      else if (path === "/circles/join")
        result = await this.rpc("walletwise_join_circle", [
          sub,
          createHash("sha256").update(body.token).digest("hex"),
          body.requestId,
        ]);
      else if (/^\/circles\/[^/]+$/.test(path))
        result = await this.rpc("walletwise_circles", [
          sub,
          path.split("/")[2],
        ]);
      else if (path.endsWith("/invite")) {
        const raw = randomBytes(32).toString("base64url");
        await this.rpc("walletwise_circle_command", [
          sub,
          "invite",
          path.split("/")[2],
          body.requestId,
          JSON.stringify({
            hash: createHash("sha256").update(raw).digest("hex"),
          }),
        ]);
        result = { url: `${url.origin}/circles/invite/${raw}` };
      } else if (path.endsWith("/contribute"))
        result = await this.rpc("walletwise_circle_contribute", [
          sub,
          path.split("/")[2],
          body.requestId,
          JSON.stringify(body),
          body.currency,
          minor(body.amount, body.currency),
          body.quoteId,
          body.sourceGoal ?? null,
        ]);
      else if (path.endsWith("/actions"))
        result = await this.rpc("walletwise_circle_command", [
          sub,
          body.action,
          path.split("/")[2],
          body.requestId,
          JSON.stringify({
            ...body,
            amount:
              body.action === "propose"
                ? body.kind === "owner"
                  ? 0
                  : minor(body.amount, body.currency)
                : undefined,
          }),
        ]);
      else if (path === "/savings/assign")
        result = await this.rpc("walletwise_assign_historical", [
          sub,
          body.requestId,
          body.goalId,
          minor(body.amount, body.currency),
        ]);
      else throw new Error(`Unsupported fixture endpoint ${path}`);
      if (req.method() !== "GET") await this.refresh();
      await route.fulfill({ json: result ?? null });
    } catch (e) {
      await route.fulfill({
        status: 409,
        json: { error: (e as Error).message },
      });
    }
  }
}
