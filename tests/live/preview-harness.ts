import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { safeSend, validatePreview, type PublicConfig } from "./environment";
import { guardContext } from "./fixtures";
import { safePath, type Target } from "./safety";
import { saveSanitizedTrace } from "./artifacts";
import type { Circle, CircleDetail, SavingsQuote } from "../../shared/circles";
import type { Currency } from "../../shared/money";
import type { OnboardingStatus } from "../../shared/types";

export type Actor = {
  alias: "A" | "B";
  sub: string;
  token: string;
  context: BrowserContext;
  page: Page;
  onboarding: OnboardingStatus;
  initial: Record<Currency, number>;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class PreviewHarness {
  target!: Target;
  config!: PublicConfig;
  actors: Actor[] = [];
  goals: { owner: Actor; id: string }[] = [];
  circles: { owner: Actor; id: string }[] = [];
  lastWrite = new Map<string, number>();
  events: { method: string; path: string; status: number }[] = [];
  safety = {
    violations: [] as { method: string; path: string }[],
    consoleErrors: [] as string[],
    failures: [] as { method: string; path: string; status?: number }[],
    expected: new Set<string>(),
  };
  run =
    process.env.LIVE_RUN_ID ||
    `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  cleanup = {
    completed: false,
    archivedGoals: 0,
    archivedCircles: 0,
    unresolved: [] as string[],
    fixtureFunds: false,
  };
  constructor(private browser: Browser) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(this.run))
      throw new Error("LIVE_RUN_ID must be a short safe run identifier.");
  }
  id(label: string) {
    const bytes = createHash("sha256")
      .update(`live:${this.run}:${label}`)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const h = bytes.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  async prepare() {
    const validated = await validatePreview();
    this.target = validated.target;
    this.config = validated.config;
    // Both real Auth0 identities must be verified before any funding fixture.
    for (const alias of ["A", "B"] as const)
      this.actors.push(await this.login(alias));
    this.journal();
  }
  async login(alias: "A" | "B", path = "/") {
    const context = await this.browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 1000 },
    });
    await guardContext(context, this.target, this.safety);
    const page = await context.newPage();
    let token = "";
    page.on("request", (request) => {
      if (request.url().startsWith(this.target.origin + "/api/bootstrap"))
        token =
          request.headers().authorization?.replace(/^Bearer /, "") || token;
    });
    try {
      await page.goto(this.target.origin + path);
      await this.fillSecret(
        page,
        "Email address",
        process.env[`LIVE_USER_${alias}_EMAIL`]!,
      );
      await page
        .getByRole("button", { name: "Continue with email", exact: true })
        .click();
      await page.waitForURL((url) => url.origin === this.target.auth0Origin, {
        timeout: 30000,
      });
      const email = page
        .getByLabel(/^Email address$|^Email$|^Username$/i)
        .first();
      if (await email.isVisible())
        await this.fillInput(email, process.env[`LIVE_USER_${alias}_EMAIL`]!);
      const password = page.getByLabel(/^Password$/i).first();
      if (!(await password.isVisible()))
        await page
          .getByRole("button", { name: /^Continue$|^Log in$|^Sign in$/i })
          .last()
          .click();
      await password.waitFor({ state: "visible", timeout: 15000 });
      await this.fillInput(
        password,
        process.env[`LIVE_USER_${alias}_PASSWORD`]!,
      );
      await page
        .getByRole("button", { name: /^Continue$|^Log in$|^Sign in$/i })
        .last()
        .click();
      await page.waitForURL((url) => url.origin === this.target.origin, {
        timeout: 45000,
      });
      for (let i = 0; i < 60 && !token; i++) await wait(250);
      if (!token) throw new Error("Session token unavailable");
      const claims = (
        await jwtVerify(
          token,
          createRemoteJWKSet(
            new URL(`${this.target.auth0Origin}/.well-known/jwks.json`),
          ),
          {
            issuer: this.target.auth0Origin + "/",
            audience: this.target.auth0ClientId,
            algorithms: ["RS256"],
          },
        )
      ).payload;
      if (
        claims.sub !== process.env[`LIVE_USER_${alias}_SUB`] ||
        claims.role !== "authenticated"
      )
        throw new Error("Dedicated identity did not match");
      const actor: Actor = {
        alias,
        sub: claims.sub!,
        token,
        context,
        page,
        onboarding: (
          await this.call<OnboardingStatus>(
            { alias, token } as Actor,
            "GET",
            "/api/onboarding",
          )
        ).body,
        initial: { USD: 0, ILS: 0, JOD: 0 },
      };
      actor.initial = await this.balances(actor);
      // Start trace only after credential entry. Raw traces are never shared.
      await context.tracing.start({
        screenshots: false,
        snapshots: false,
        sources: false,
      });
      return actor;
    } catch {
      await context.close();
      throw new Error(
        "Dedicated Auth0 login/identity verification failed. Check Preview callback, test accounts, Action, connection, verification and provider challenges; private details withheld.",
      );
    }
  }
  private async fillSecret(page: Page, label: string, value: string) {
    await this.fillInput(page.getByLabel(label, { exact: true }), value);
  }
  private async fillInput(
    locator: ReturnType<Page["getByLabel"]>,
    value: string,
  ) {
    // Avoid Playwright's fill step title echoing a password/email into HTML.
    await locator.evaluate((input, text) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
  async call<T = unknown>(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
  ) {
    if (!["GET", "HEAD"].includes(method)) {
      await wait(
        Math.max(0, (this.lastWrite.get(actor.alias) || 0) + 2200 - Date.now()),
      );
      this.lastWrite.set(actor.alias, Date.now());
    }
    const result = await safeSend<T>(
      this.target,
      method,
      path,
      actor.token,
      body,
    );
    this.events.push({
      method,
      path: safePath(new URL(path, this.target.origin).href),
      status: result.status,
    });
    return result;
  }
  async ok<T = unknown>(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const result = await this.call<T>(actor, method, path, body);
    if (result.status !== 200)
      throw new Error(
        `Live API operation failed with status ${result.status} at ${safePath(new URL(path, this.target.origin).href)}; values withheld.`,
      );
    return result.body;
  }
  async db<T = Record<string, unknown>[]>(
    path: string,
    rpcBody?: unknown,
  ): Promise<T> {
    if (
      !this.target.mutationReady ||
      !this.target.databaseOrigin ||
      this.target.databaseOrigin !==
        process.env.LIVE_SUPABASE_TEST_URL?.replace(/\/$/, "")
    )
      throw new Error("LIVE SAFETY GUARD: test database is not verified.");
    if (
      rpcBody !== undefined &&
      (path !== "/rpc/walletwise_apply_transaction" ||
        process.env.LIVE_ALLOW_TEST_FIXTURE_FUNDS !== "true")
    )
      throw new Error(
        "LIVE SAFETY GUARD: only explicitly enabled balanced fixture RPCs are permitted.",
      );
    let response: Response;
    try {
      response = await fetch(`${this.target.databaseOrigin}/rest/v1${path}`, {
        method: rpcBody === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Prefer: "count=exact",
          apikey: process.env.LIVE_SUPABASE_TEST_SECRET_KEY!,
          Authorization: `Bearer ${process.env.LIVE_SUPABASE_TEST_SECRET_KEY!}`,
          ...(rpcBody === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(rpcBody === undefined ? {} : { body: JSON.stringify(rpcBody) }),
      });
    } catch {
      throw new Error("Test database request unavailable; details withheld.");
    }
    if (!response.ok)
      throw new Error("Test database read/fixture failed; details withheld.");
    const result = await response.json();
    // PostgREST can cap a requested limit. Never validate a partial ledger.
    const total = response.headers.get("content-range")?.split("/")[1];
    if (
      Array.isArray(result) &&
      total &&
      total !== "*" &&
      Number(total) > result.length
    )
      throw new Error(
        "BLOCKED: database response is paginated; use fresh bounded test accounts.",
      );
    return result;
  }
  async balances(actor: Actor) {
    const rows = await this.db<
      { currency: Currency; available_minor: number | string }[]
    >(
      `/wallets?select=currency,available_minor&auth0_sub=eq.${encodeURIComponent(actor.sub)}`,
    );
    const result = { USD: 0, ILS: 0, JOD: 0 };
    for (const row of rows) result[row.currency] = Number(row.available_minor);
    return result;
  }
  async seed() {
    if (process.env.LIVE_ALLOW_TEST_FIXTURE_FUNDS !== "true")
      throw new Error(
        "BLOCKED: balanced test fixture funding is not explicitly enabled.",
      );
    this.cleanup.fixtureFunds = true;
    this.journal();
    for (const actor of this.actors)
      for (const currency of ["USD", "ILS", "JOD"] as const) {
        const amount = currency === "JOD" ? 500000 : 50000;
        await this.db("/rpc/walletwise_apply_transaction", {
          p_auth0_sub: actor.sub,
          p_request_id: this.id(`fixture:${actor.alias}:${currency}`),
          p_request_fingerprint: `live:${this.run}:${actor.alias}:${currency}`,
          p_kind: "adjustment",
          p_description: "Isolated live QA fixture",
          p_category: "Test fixture",
          p_entries: [
            { currency, account: "available", amount_minor: amount },
            { currency, account: "external", amount_minor: -amount },
          ],
          p_metadata: { isolatedLiveTest: this.run },
        });
      }
    this.cleanup.fixtureFunds = true;
    this.journal();
  }
  async ledger(actor: Actor) {
    const rows = await this.db<
      {
        transaction_id: string;
        currency: Currency;
        account: string;
        amount_minor: number | string;
      }[]
    >(
      `/ledger_entries?select=transaction_id,currency,account,amount_minor&auth0_sub=eq.${encodeURIComponent(actor.sub)}&limit=10000`,
    );
    if (rows.length === 10000)
      throw new Error(
        "BLOCKED: test account is too large for the bounded invariant check; use a fresh dedicated account.",
      );
    const wallets = await this.db<
      {
        currency: Currency;
        available_minor: number | string;
        savings_minor: number | string;
      }[]
    >(
      `/wallets?select=currency,available_minor,savings_minor&auth0_sub=eq.${encodeURIComponent(actor.sub)}`,
    );
    const sums = new Map<string, bigint>();
    for (const row of rows) {
      const value = BigInt(row.amount_minor);
      for (const key of [
        `tx:${row.transaction_id}:${row.currency}`,
        `wallet:${row.currency}:${row.account}`,
      ])
        sums.set(key, (sums.get(key) || 0n) + value);
    }
    for (const [key, value] of sums)
      if (key.startsWith("tx:") && value !== 0n)
        throw new Error(
          "Financial invariant failed: transaction postings do not balance.",
        );
    if (wallets.length !== 3)
      throw new Error(
        "Financial invariant failed: three currency wallets are required.",
      );
    for (const wallet of wallets)
      for (const account of ["available", "savings"] as const)
        if (
          BigInt(wallet[`${account}_minor`]) < 0n ||
          BigInt(wallet[`${account}_minor`]) !==
            (sums.get(`wallet:${wallet.currency}:${account}`) || 0n)
        )
          throw new Error(
            "Financial invariant failed: wallet and ledger disagree.",
          );
  }
  async goal(actor: Actor, label: string, currency: Currency) {
    const value = await this.ok<{ id: string }>(actor, "POST", "/api/goals", {
      requestId: this.id(`goal:${actor.alias}:${label}`),
      name: `QA ${this.run} ${label}`,
      currency,
      amount: "500.00",
      makeDefault: false,
    });
    this.goals.push({ owner: actor, id: value.id });
    this.journal();
    return value.id;
  }
  async circle(actor: Actor, label: string, amount = "100.00") {
    const circle = await this.ok<Circle>(actor, "POST", "/api/circles", {
      requestId: this.id(`circle:${label}`),
      name: `QA ${this.run} ${label}`,
      description: "Isolated automated test",
      currency: "USD",
      amount,
      icon: "users",
    });
    this.circles.push({ owner: actor, id: circle.id });
    this.journal();
    return circle.id;
  }
  detail(actor: Actor, id: string) {
    return this.ok<CircleDetail>(actor, "GET", `/api/circles/${id}`);
  }
  async quote(
    actor: Actor,
    currency: Currency,
    amount: string,
    destination: { kind: "goal" | "circle"; id: string },
    purchase = false,
  ) {
    return this.ok<{ quote: SavingsQuote; saved: number }>(
      actor,
      "POST",
      "/api/savings/preview",
      { currency, amount, destination, purchase },
    );
  }
  async contribution(
    actor: Actor,
    circle: string,
    label: string,
    amount = "2.00",
  ) {
    const { quote } = await this.quote(actor, "USD", amount, {
      kind: "circle",
      id: circle,
    });
    const body = {
      requestId: this.id(`contribute:${actor.alias}:${label}`),
      currency: "USD",
      amount,
      quoteId: quote.id,
      confirmed: true,
    };
    const result = await this.ok<{ id: string }>(
      actor,
      "POST",
      `/api/circles/${circle}/contribute`,
      body,
    );
    return { body, result };
  }
  async action(
    actor: Actor,
    circle: string,
    label: string,
    payload: Record<string, unknown>,
  ) {
    return this.ok(actor, "POST", `/api/circles/${circle}/actions`, {
      requestId: this.id(`action:${actor.alias}:${label}`),
      ...payload,
    });
  }
  async propose(
    owner: Actor,
    circle: string,
    label: string,
    kind: "withdraw" | "return_all" | "target",
    amount: string,
  ) {
    const detail = await this.detail(owner, circle);
    await this.action(owner, circle, label, {
      action: "propose",
      kind,
      amount,
      currency: "USD",
      destination:
        kind === "withdraw" ? detail.members.find((m) => m.you)!.id : null,
      reason: `QA ${this.run} ${label}`,
      confirmed: true,
    });
    const proposal = (await this.detail(owner, circle)).proposals.find(
      (p) => p.reason === `QA ${this.run} ${label}`,
    );
    if (!proposal) throw new Error("Circle proposal was not persisted.");
    return proposal.id;
  }
  async close() {
    // Supported API cleanup only, never bypass approvals or delete ledger rows.
    for (const resource of this.circles)
      try {
        let detail = await this.detail(resource.owner, resource.id);
        await this.action(
          resource.owner,
          resource.id,
          `cleanup-revoke:${resource.id}`,
          { action: "revoke" },
        );
        for (const p of detail.proposals.filter((p) =>
          ["Pending", "Approved", "Failed"].includes(p.status),
        ))
          await this.action(
            resource.owner,
            resource.id,
            `cleanup-cancel:${p.id}`,
            { action: "cancel", proposalId: p.id },
          );
        if (BigInt(detail.balance) > 0n) {
          const proposal = await this.propose(
            resource.owner,
            resource.id,
            `cleanup-return:${resource.id}`,
            "return_all",
            "0.00",
          );
          for (const actor of this.actors) {
            const current = await this.detail(actor, resource.id).catch(
              () => undefined,
            );
            if (!current) continue;
            const member = current.members.find((m) => m.you);
            if (
              member &&
              current.proposals
                .find((p) => p.id === proposal)
                ?.votes.some(
                  (v) => v.memberId === member.id && v.decision === null,
                )
            )
              await this.action(
                actor,
                resource.id,
                `cleanup-vote:${proposal}`,
                { action: "vote", proposalId: proposal, decision: "Approve" },
              );
          }
          await this.action(
            resource.owner,
            resource.id,
            `cleanup-execute:${proposal}`,
            { action: "execute", proposalId: proposal },
          );
        }
        detail = await this.detail(resource.owner, resource.id);
        if (BigInt(detail.balance) !== 0n) throw new Error();
        await this.action(
          resource.owner,
          resource.id,
          `cleanup-archive:${resource.id}`,
          { action: "archive" },
        );
        this.cleanup.archivedCircles++;
      } catch {
        this.cleanup.unresolved.push(
          `circle-${this.circles.indexOf(resource) + 1}`,
        );
      }
    for (const goal of this.goals)
      try {
        await this.ok(goal.owner, "DELETE", `/api/goals/${goal.id}`);
        this.cleanup.archivedGoals++;
      } catch {
        this.cleanup.unresolved.push(`goal-${this.goals.indexOf(goal) + 1}`);
      }
    if (this.cleanup.fixtureFunds)
      this.cleanup.unresolved.push(
        "Unused/consumed fixture funds remain recorded in the isolated ledger; review the private run journal before another funded run.",
      );
    this.cleanup.completed = this.cleanup.unresolved.length === 0;
    this.journal();
    for (const actor of this.actors) {
      const raw = `.temp/live-state/${this.run}-${actor.alias}-raw.zip`;
      try {
        await actor.context.tracing.stop({ path: raw });
        saveSanitizedTrace(
          raw,
          `.temp/live-state/${this.run}-${actor.alias}-redacted.zip`,
        );
      } finally {
        await actor.context.close();
      }
    }
  }
  journal() {
    mkdirSync(".temp/live-state", { recursive: true });
    writeFileSync(
      `.temp/live-state/${this.run}.json`,
      JSON.stringify(
        {
          run: this.run,
          preview: this.target?.origin,
          identities: this.actors.map((a) => ({
            alias: a.alias,
            sub: a.sub,
            initial: a.initial,
          })),
          goals: this.goals.map((g) => ({ owner: g.owner.alias, id: g.id })),
          circles: this.circles.map((c) => ({
            owner: c.owner.alias,
            id: c.id,
          })),
          cleanup: this.cleanup,
        },
        null,
        2,
      ),
    );
  }
}
