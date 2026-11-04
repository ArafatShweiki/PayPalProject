import { it, expect } from "vitest";
import { app } from "../server/app";
it("protects all account and funding routes against absent tokens, cookies and forged flags", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const path of [
      "/state",
      "/bootstrap",
      "/dashboard",
      "/activity",
      "/account/reports",
      "/funding",
      "/rates/live",
      "/savings/options",
      "/circles",
      "/circles/invitations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "/circles/11111111-1111-4111-8111-111111111111",
      "/market-data/live",
    ]) {
      const response = await fetch(base + "/api" + path + "?demo=true", {
        headers: {
          Cookie: "walletwise:developer-demo:v1=true",
          "x-demo": "true",
        },
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toMatch(/balances|ledger|approval_url/);
    }
    for (const path of [
      "/purchases",
      "/refunds",
      "/funding/orders",
      "/circles/join",
      "/circles/11111111-1111-4111-8111-111111111111/contribute",
      "/circles/11111111-1111-4111-8111-111111111111/actions",
    ])
      expect(
        (
          await fetch(base + "/api" + path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-walletwise": "1",
            },
            body: JSON.stringify({ amount: "500", currency: "USD" }),
          })
        ).status,
      ).toBe(401);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
