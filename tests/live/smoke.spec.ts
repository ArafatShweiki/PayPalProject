import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { test, expect, production } from "./fixtures";
import { publicConfig } from "./environment";
import { suspiciousPublicText } from "./artifacts";
import { safeScreenshot } from "./fixtures";
import { infoPages } from "../../src/infoContent";

const privateValues: string[] = [];
for (const file of [".env.local", ".env", ".env.auth0", ".env.live.local"])
  if (existsSync(file))
    for (const [key, value] of Object.entries(parse(readFileSync(file))))
      if (
        /SECRET|PRIVATE_KEY|SERVICE_ROLE|GEMINI_API_KEY|TWELVE_DATA_API_KEY|PASSWORD|DATABASE_URL/.test(
          key,
        ) &&
        value.length >= 12
      )
        privateValues.push(value);

test("public configuration is live JSON, initializes the function, and exposes only allowed values", async ({
  api,
}, info) => {
  const result = await api("GET", "/api/config");
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")?.includes("application/json")).toBe(
    true,
  );
  expect(result.headers.get("cache-control")?.includes("no-store")).toBe(true);
  const config = publicConfig(result.body);
  expect(
    config.auth0 !== null && config.supabase !== null,
    "Auth0 and Supabase must be configured.",
  ).toBe(true);
  expect(
    suspiciousPublicText(JSON.stringify(result.body), privateValues),
    "Public configuration contains a possible private credential; value withheld.",
  ).toBe(false);
  await info.attach("deployment-evidence", {
    body: JSON.stringify({
      origin: production.origin,
      apiStatus: result.status,
      hostedCommit: "not exposed",
      requestCorrelationHeaderPresent: !!result.headers.get("x-request-id"),
    }),
    contentType: "application/json",
  });
});

test("signed-out private APIs return JSON authorization errors without private data", async ({
  api,
}) => {
  for (const path of [
    "/api/state",
    "/api/dashboard",
    "/api/activity",
    "/api/account/reports",
    "/api/funding",
    "/api/onboarding",
    "/api/savings/options",
    "/api/circles",
    "/api/rates/history?period=24h",
  ]) {
    const result = await api("GET", path);
    expect(result.status, "Signed-out private endpoint must deny access.").toBe(
      401,
    );
    expect(
      typeof result.body === "object" &&
        result.body !== null &&
        "error" in result.body,
    ).toBe(true);
    expect(
      !/"(?:balances|ledger|approval_url|auth0_sub|wallet_preferences)"/.test(
        JSON.stringify(result.body),
      ),
    ).toBe(true);
    expect(result.headers.get("cache-control")?.includes("no-store")).toBe(
      true,
    );
  }
});

test("malformed and unsigned tokens are rejected by the backend or confirmed Vercel firewall", async ({
  api,
}, info) => {
  const rejections: { probe: string; status: number; layer: string }[] = [];
  for (const token of [
    "live-smoke-invalid",
    "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.",
  ]) {
    const result = await api("GET", "/api/state", token);
    if (result.rejectionLayer === "vercel-firewall") {
      expect(result.status).toBe(403);
      expect(result.body).toBeNull();
    } else {
      expect(result.status).toBe(401);
      expect(
        result.headers.get("content-type")?.includes("application/json"),
      ).toBe(true);
      expect(
        typeof result.body === "object" &&
          result.body !== null &&
          "error" in result.body,
      ).toBe(true);
    }
    rejections.push({
      probe: token === "live-smoke-invalid" ? "malformed" : "unsigned-expired",
      status: result.status,
      layer: result.rejectionLayer || "application",
    });
    expect(
      !/stack|ERR_MODULE_NOT_FOUND|at jwtVerify/.test(
        JSON.stringify(result.body),
      ),
    ).toBe(true);
  }
  await info.attach("authentication-rejection-layers", {
    body: JSON.stringify(rejections),
    contentType: "application/json",
  });
});

test("home branding, built assets and public bundles load without backend/secret regressions", async ({
  page,
}, info) => {
  await page.goto(production.origin);
  await expect(
    page.getByRole("button", { name: "Continue with PayPal" }),
  ).toBeVisible();
  await expect(page.locator(".brand").first()).toContainText(
    "Dream Piggy Bank",
  );
  const html = await page.content();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"#?]+)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
  expect(assets.length > 0).toBe(true);
  // Use the guarded browser's GET-only fetch, not an unguarded API context.
  for (const asset of assets) {
    const response = await page.evaluate(async (path) => {
      const r = await fetch(path, { cache: "no-store" });
      return {
        status: r.status,
        type: r.headers.get("content-type"),
        text: await r.text(),
      };
    }, asset);
    expect(response.status).toBe(200);
    expect(
      response.type?.includes(
        asset.endsWith(".css") ? "text/css" : "javascript",
      ),
    ).toBe(true);
    expect(
      suspiciousPublicText(response.text, privateValues),
      "Possible secret in public asset; contents withheld.",
    ).toBe(false);
  }
  expect(
    await page
      .locator(".auth-layout")
      .evaluate((element) => getComputedStyle(element).display !== "block"),
  ).toBe(true);
  await info.attach("asset-version", {
    body: JSON.stringify({
      fingerprint: createHash("sha256")
        .update(assets.sort().join("\n"))
        .digest("hex"),
      assetPaths: assets,
      attribution: "asset fingerprint, not a verified deployed Git commit",
    }),
    contentType: "application/json",
  });
  await safeScreenshot(page, info, "public-home");
});

for (const width of [375, 768, 1024, 1440])
  test(`public sign-in and invitation layout at ${width}px`, async ({
    page,
    evidence,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(production.origin);
    await expect(
      page.getByRole("button", { name: "Continue with PayPal" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
    ).toBe(true);
    await safeScreenshot(page, info, `home-${width}`);
    evidence.expected.add("/api/circles/invite/[redacted]");
    await page.goto(`${production.origin}/circles/invite/${"z".repeat(43)}`);
    await expect(
      page.getByText("This invitation is invalid, revoked, or expired."),
    ).toBeVisible();
    expect(await page.locator(".auth-card .circle-invitation").count()).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await safeScreenshot(page, info, `invalid-invitation-${width}`);
  });

test("public Help Center search, category filter, labels and direct refresh work", async ({
  page,
}, info) => {
  await page.goto(`${production.origin}/help`);
  await expect(
    page.getByRole("heading", { name: "Help Center", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search help").fill("round");
  expect((await page.locator(".help-articles article").count()) > 0).toBe(true);
  await page.getByLabel("Search help").fill("no-matching-live-smoke-article");
  await expect(
    page.getByText("No matching articles. Try a different phrase or category."),
  ).toBeVisible();
  await page.getByLabel("Search help").fill("");
  await page.getByLabel("Category").selectOption({ index: 1 });
  expect((await page.locator(".help-articles article").count()) > 0).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Help Center", exact: true }),
  ).toBeVisible();
  await safeScreenshot(page, info, "public-help");
});

test("all implemented public information/legal pages and unknown routes survive direct loads", async ({
  page,
}) => {
  for (const [path, content] of Object.entries(infoPages)) {
    await page.goto(production.origin + path);
    await expect(
      page.getByRole("heading", { name: content.title, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: content.title, exact: true }),
    ).toBeVisible();
  }
  await page.goto(`${production.origin}/live-smoke-unknown-page`);
  await expect(
    page.getByRole("heading", { name: /Page not found|couldn.t find|404/i }),
  ).toBeVisible();
});

test("every protected hash route remains behind authentication after direct load/refresh", async ({
  page,
}) => {
  for (const section of [
    "Home",
    "My Wallet",
    "Smart Savings",
    "Savings Circles",
    "Currency Rates",
    "Reports",
    "Settings",
  ]) {
    await page.goto(`${production.origin}/#${encodeURIComponent(section)}`);
    await expect(
      page.getByRole("button", { name: "Continue with PayPal" }),
    ).toBeVisible();
    expect(await page.getByRole("navigation").count()).toBe(0);
  }
});

test("authenticated Production wallet reads require separately authorized safe credentials", async ({}) => {
  test.info().annotations.push({
    type: "blocked",
    description:
      "No dedicated Production read-only credentials are configured/authorized. Authenticated GET paths can initialize state; do not bypass this blocker.",
  });
  test.skip(true, "BLOCKED: no authorized Production read-only session.");
});
