import { expect, test } from "@playwright/test";

test("production assets, direct links and API isolation use the real exported handler", async ({
  request,
  page,
}) => {
  for (const path of [
    "/",
    "/onboarding",
    "/reset-password",
    "/help",
    "/missing-page",
    `/circles/invite/${"a".repeat(43)}`,
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["content-security-policy"]).toContain(
      "https://www.sandbox.paypal.com",
    );
  }
  const html = await (await request.get("/")).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets)
    expect((await request.get(asset)).status()).toBe(200);
  expect((await request.get("/assets/missing.js")).status()).toBe(404);
  for (const path of ["/api", "/api/state", "/api/unknown"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  expect((await request.get("/api/cron")).status()).toBe(401);
  expect(
    (
      await request.post("/api/purchases", {
        headers: { origin: "https://attacker.test", "x-walletwise": "1" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await request.post("/api/purchases", { data: {} })).status()).toBe(
    403,
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with PayPal" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue with PayPal" }),
  ).toBeVisible();
  await page.goto("/missing-page");
  await expect(page.getByText(/page.*(?:not|find)|404/i).first()).toBeVisible();
});
