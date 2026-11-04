import express from "express";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { CircleLedgerFixture } from "./fixtures/circle-ledger";
import type { CircleDetail } from "../shared/circles";
const testState = vi.hoisted(() => ({
  rpc: undefined as
    | undefined
    | ((name: string, args: Record<string, unknown>) => Promise<unknown>),
}));
vi.mock("../server/supabase", async (original) => ({
  ...(await original<typeof import("../server/supabase")>()),
  getServerSupabase: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        return { data: await testState.rpc!(name, args) };
      } catch (error) {
        return { error: { code: "P0001", message: (error as Error).message } };
      }
    },
  }),
  readIdempotentTransaction: async () => undefined,
}));
let ledger: CircleLedgerFixture, server: Server, base: string;
let owner: string, member: string, outsider: string;
beforeAll(async () => {
  ledger = new CircleLedgerFixture();
  await ledger.initialize();
  testState.rpc = async (name, args) => {
    const result = await ledger.db.query(
      `select public.${name}(${Object.keys(args)
        .map((key, i) => `${key} => $${i + 1}`)
        .join(",")})`,
      Object.values(args),
    );
    return Object.values(result.rows[0] as object)[0];
  };
  owner = await ledger.account(`api-owner-${randomUUID()}`);
  member = await ledger.account(`api-member-${randomUUID()}`);
  outsider = await ledger.account(`api-outsider-${randomUUID()}`);
  const { circlesRouter } = await import("../server/savings-circles");
  const app = express();
  app.use(express.json());
  // Explicit test identity seam. Production token verification is exercised separately.
  app.use((req, res, next) => {
    res.locals.sub = req.get("x-test-sub");
    next();
  });
  app.use(circlesRouter);
  app.use(
    (
      error: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.status || 400).json({ error: error.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 30000);
afterAll(async () => {
  await new Promise<void>((done) => server?.close(() => done()));
  await ledger?.db.close();
});
async function call(sub: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-test-sub": sub },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function create() {
  const result = await call(owner, "/circles", {
    requestId: randomUUID(),
    name: "API trip",
    description: "",
    currency: "USD",
    amount: "100.00",
  });
  expect(result.status).toBe(200);
  const id = result.body.id as string;
  const invite = await call(owner, `/circles/${id}/invite`, {
    requestId: randomUUID(),
  });
  expect(invite.status).toBe(200);
  const token = new URL(invite.body.url).pathname.split("/").at(-1)!;
  return { id, token };
}
async function contribute(sub: string, id: string) {
  const quote = await ledger.quote(sub, "USD", 200, { kind: "circle", id });
  const body = {
    requestId: randomUUID(),
    currency: "USD",
    amount: "2.00",
    quoteId: quote.id,
    confirmed: true,
  };
  const results = await Promise.all([
    call(sub, `/circles/${id}/contribute`, body),
    call(sub, `/circles/${id}/contribute`, body),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results[0].body.id).toBe(results[1].body.id);
}
it("private invitation status recognizes membership, rejects misuse and records one join", async () => {
  const { id, token } = await create();
  expect(
    (await call(member, `/circles/invitations/${token}`)).body,
  ).toMatchObject({ alreadyMember: false, circleId: null });
  const first = await call(member, "/circles/join", {
    requestId: randomUUID(),
    token,
  });
  expect(first.body).toMatchObject({ id, alreadyMember: false });
  expect(
    (await call(member, "/circles/join", { requestId: randomUUID(), token }))
      .body.alreadyMember,
  ).toBe(true);
  expect(
    (await call(member, `/circles/invitations/${token}`)).body,
  ).toMatchObject({ alreadyMember: true, circleId: id });
  expect((await call(outsider, `/circles/${id}`)).status).toBe(409);
  expect(
    (await call(member, `/circles/${id}/invite`, { requestId: randomUUID() }))
      .status,
  ).toBe(409);
  expect(
    (
      await call(member, "/circles/join", {
        requestId: randomUUID(),
        token: "short",
      })
    ).status,
  ).toBe(400);
  await call(owner, `/circles/${id}/actions`, {
    requestId: randomUUID(),
    action: "revoke",
  });
  expect((await call(member, `/circles/invitations/${token}`)).status).toBe(
    404,
  );
  expect(
    (await call(member, "/circles/join", { requestId: randomUUID(), token }))
      .status,
  ).toBe(409);
});
it("requires both contributors' exact approvals through the API and executes once", async () => {
  const { id, token } = await create();
  await call(member, "/circles/join", { requestId: randomUUID(), token });
  await contribute(owner, id);
  await contribute(member, id);
  const detail = (await call(owner, `/circles/${id}`)).body as CircleDetail;
  expect(detail.balance).toBe("400");
  expect(detail.members.reduce((sum, m) => sum + Number(m.share), 0)).toBe(400);
  const proposal = {
    requestId: randomUUID(),
    action: "propose",
    kind: "withdraw",
    currency: "USD",
    amount: "1.00",
    destination: detail.members.find((m) => m.you)!.id,
    reason: "API transfer",
    confirmed: true,
  };
  expect((await call(member, `/circles/${id}/actions`, proposal)).status).toBe(
    409,
  );
  const created = await call(owner, `/circles/${id}/actions`, proposal);
  expect(created.status).toBe(200);
  const proposalId = created.body.proposalId;
  const execute = () =>
    call(owner, `/circles/${id}/actions`, {
      requestId: randomUUID(),
      action: "execute",
      proposalId,
    });
  expect((await execute()).status).toBe(409);
  expect(
    (
      await call(outsider, `/circles/${id}/actions`, {
        requestId: randomUUID(),
        action: "vote",
        proposalId,
        decision: "Approve",
        memberId: detail.members[0].id,
      })
    ).status,
  ).toBe(409);
  await call(owner, `/circles/${id}/actions`, {
    requestId: randomUUID(),
    action: "vote",
    proposalId,
    decision: "Approve",
  });
  expect((await execute()).status).toBe(409);
  await call(member, `/circles/${id}/actions`, {
    requestId: randomUUID(),
    action: "vote",
    proposalId,
    decision: "Approve",
  });
  expect((await execute()).body.status).toBe("Completed");
  expect((await execute()).body.status).toBe("Completed");
  const after = (await call(owner, `/circles/${id}`)).body as CircleDetail;
  expect(after.balance).toBe("300");
  expect(after.members.reduce((sum, m) => sum + Number(m.share), 0)).toBe(300);
  expect(
    after.entries
      .filter((e) => e.kind === "distribution")
      .reduce((sum, e) => sum + Number(e.amount), 0),
  ).toBe(-100);
  expect(
    (
      await call(member, `/circles/${id}/actions`, {
        requestId: randomUUID(),
        action: "leave",
      })
    ).status,
  ).toBe(409);
});
