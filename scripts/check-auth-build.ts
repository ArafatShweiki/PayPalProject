import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";

const forbidden =
  /walletwise:developer-demo|createDemoService|demoMarketMode|test-wallet-fixture|createWalletFixture|\/wallet-test|VITE_ENABLE_DEMO_MODE|Explore Dream Piggy Bank|Add Demo Funds/;
for (const entry of await readdir("dist/assets")) {
  if (entry.endsWith(".js"))
    assert(
      !forbidden.test(await readFile(join("dist/assets", entry), "utf8")),
      `Unexpected fixture/development access in ${entry}`,
    );
}
const origin = "http://127.0.0.1:5193";
const server = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "5193",
    "--strictPort",
  ],
  { stdio: "ignore", windowsHide: true },
);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Production preview could not start.");
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* wait for preview readiness */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(ready, "Production preview did not become ready.");
  browser = await chromium.launch();
  const page = await browser.newPage();
  let privateReads = 0;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        auth0: {
          domain: "example.auth0.com",
          clientId: "auth-build-client",
          databaseConnection: "database",
        },
        supabase: null,
      },
    }),
  );
  await page.route("**/api/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/config")
      return route.fallback();
    privateReads++;
    return route.fulfill({ status: 401, json: { error: "Sign in required." } });
  });
  await page.addInitScript(() => {
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem(
        "walletwise:developer-demo:v1",
        JSON.stringify({
          enabled: true,
          authMode: "demo",
          balances: { USD: 999999, ILS: 999999, JOD: 999999 },
        }),
      );
      storage.setItem("walletwise:developer-demo:enabled", "true");
    }
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const hash of [
      "Home",
      "My Wallet",
      "Smart Savings",
      "Currency Rates",
      "Reports",
      "Settings",
    ]) {
      await page.goto(
        `${origin}/?demo=true&funding=approved&fundingId=10000000-0000-4000-8000-000000000001#${encodeURIComponent(hash)}`,
      );
      await expect(
        page.getByRole("heading", { name: "Welcome back." }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Continue with PayPal" }),
      ).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: /Explore Dream Piggy Bank|Add Funds/,
        }),
      ).toHaveCount(0);
    }
  }
  assert.equal(
    privateReads,
    0,
    "Protected financial APIs must not be read before authentication.",
  );
  console.log(
    "Production assets exclude fixture access; all six wallet sections require sign-in at desktop and mobile sizes, including forged storage/return parameters.",
  );
} finally {
  await browser?.close();
  server.kill();
}
