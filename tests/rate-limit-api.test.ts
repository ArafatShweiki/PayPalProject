import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
vi.mock("../server/auth0", () => ({
  auth0Enabled: true,
  auth0Config: { domain: "example.auth0.com", clientId: "test" },
  verifyWalletIdentity: async (token: string) => {
    if (!token.startsWith("verified-")) throw new Error("invalid");
    return { uid: token, sub: token };
  },
}));
import { app } from "../server/app";
import { userUpdate } from "../server/store";
let server: Server, base: string;
beforeAll(async () => {
  vi.stubEnv("RATE_LIMIT_FINANCIAL", "1");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((r) => server.close(() => r()));
});
async function identity() {
  const uid = `verified-${randomUUID()}`;
  await userUpdate(uid, (data) => {
    data.profile = {
      fullName: "Test",
      email: "test@example.invalid",
      emailVerified: false,
      completedAt: new Date().toISOString(),
    };
  });
  return uid;
}
const send = (uid: string) =>
  fetch(`${base}/api/goals`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${uid}`,
      "X-WalletWise": "1",
      "Content-Type": "application/json",
      "X-User-ID": randomUUID(),
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      name: "Goal",
      currency: "USD",
      amount: "10",
    }),
  });
it("enforces actual verified-user limits with Retry-After, private headers and account isolation", async () => {
  const a = await identity(),
    b = await identity();
  expect((await send(a)).status).toBe(200);
  const denied = await send(a);
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(denied.headers.get("cache-control")).toContain("no-store");
  expect(denied.headers.get("x-request-id")).toBeTruthy();
  expect((await denied.json()).error).toContain("Too many requests");
  expect((await send(b)).status).toBe(200);
  expect((await send("forged")).status).toBe(401);
});
