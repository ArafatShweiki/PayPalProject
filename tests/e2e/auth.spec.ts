import { writeFileSync } from "node:fs";
import { loadingResponse } from "../fixtures/loading";
import type { State } from "../../shared/types";
import { walletFixture } from "./fixtures";
import { test, expect } from "@playwright/test";

test("responsive Auth0 entry protects deep links and supports reset feedback", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        auth0: {
          domain: "example.auth0.com",
          clientId: "wallet-test",
          databaseConnection: "database",
        },
      },
    }),
  );
  await page.route(
    "https://example.auth0.com/dbconnections/change_password",
    (route) => route.fulfill({ status: 200, body: "Email sent" }),
  );
  await page.goto("/#Settings");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with PayPal" }),
  ).toBeVisible();
  await expect(page.getByText(/Google/)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    /Auth0|Supabase|\bSandbox\b/i,
  );
  await expect(
    page.getByText("PayPal sign-in is for test accounts only."),
  ).toBeVisible();
  await expect(page.getByText("Your preferences", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "test-results/auth-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A fresh start for your finances." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with PayPal" }),
  ).toBeVisible();
  await expect(page.getByText(/Google/)).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill("person@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If an email/password account exists",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/auth-mobile.png",
    fullPage: true,
  });
});

test("Circle invitation stays inside the sign-in card across mobile, tablet and desktop", async ({
  page,
}) => {
  const token = "a".repeat(43);
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        auth0: {
          domain: "example.auth0.com",
          clientId: "wallet-test",
          databaseConnection: "database",
        },
      },
    }),
  );
  await page.route(`**/api/circles/invite/${token}`, (route) =>
    route.fulfill({
      json: {
        name: "Family trip",
        description: "A shared family savings goal",
        currency: "USD",
        target: "10000",
      },
    }),
  );
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/circles/invite/${token}`);
    await expect(
      page
        .locator(".auth-card .circle-invitation")
        .getByRole("heading", { name: "Join Family trip" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Join Circle", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await expect(page.locator(".auth-card .circle-invitation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "A fresh start for your finances." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/invitation-auth-${width}.png`,
      fullPage: true,
    });
  }
});

for (const mode of ["login", "signup"]) {
  test(`PayPal ${mode} uses the Auth0 SDK redirect and handles cancellation`, async ({
    page,
  }) => {
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: {
          auth0: {
            domain: "example.auth0.com",
            clientId: "wallet-test",
            databaseConnection: "database",
          },
        },
      }),
    );
    let authorization: URL | undefined;
    await page.route(
      "https://example.auth0.com/authorize?**",
      async (route) => {
        authorization = new URL(route.request().url());
        await route.fulfill({
          contentType: "text/html",
          body: "<p>Auth0 authorization intercepted</p>",
        });
      },
    );
    await page.goto("/#Settings");
    if (mode === "signup")
      await page
        .getByRole("button", { name: "Create an account", exact: true })
        .click();
    await page.getByRole("button", { name: "Continue with PayPal" }).click();
    await expect
      .poll(() => authorization?.searchParams.get("connection"))
      .toBe("paypal-sandbox");
    expect(authorization!.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization!.searchParams.has("audience")).toBe(false);
    expect(authorization!.searchParams.get("screen_hint")).toBeNull();
    const callback = new URL(authorization!.searchParams.get("redirect_uri")!);
    callback.searchParams.set(
      "state",
      authorization!.searchParams.get("state")!,
    );
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("error_description", "User cancelled login");
    await page.goto(callback.toString());
    await expect(page.getByRole("alert")).toContainText(
      /You cancelled PayPal sign-in|We could not complete sign-in/,
    );
    await expect(
      page.getByRole("button", { name: "Continue with PayPal" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Continue with email" }),
    ).toBeEnabled();
    await expect(
      page.getByText("Your preferences", { exact: true }),
    ).toHaveCount(0);
  });
}

for (const mode of ["login", "signup"]) {
  test(`email ${mode} requests OIDC without a custom audience`, async ({
    page,
  }) => {
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: {
          auth0: {
            domain: "example.auth0.com",
            clientId: "wallet-test",
            databaseConnection: "database",
          },
        },
      }),
    );
    let authorization: URL | undefined;
    await page.route("https://example.auth0.com/authorize?**", (route) => {
      authorization = new URL(route.request().url());
      return route.fulfill({
        contentType: "text/html",
        body: "Mock hosted login",
      });
    });
    await page.goto("/");
    if (mode === "signup")
      await page
        .getByRole("button", { name: "Create an account", exact: true })
        .click();
    await page.getByLabel("Email address").fill("person@example.com");
    await page
      .getByRole("button", {
        name: mode === "signup" ? "Create account" : "Continue with email",
        exact: true,
      })
      .click();
    await expect
      .poll(() => authorization?.searchParams.get("connection"))
      .toBe("database");
    expect(authorization!.searchParams.has("audience")).toBe(false);
    expect(authorization!.searchParams.get("scope")).toContain(
      "openid profile email",
    );
    expect(authorization!.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization!.searchParams.get("screen_hint")).toBe(
      mode === "signup" ? "signup" : null,
    );
  });
}

test("mocked Auth0 callback restores a returning Supabase profile, persists on reload and logs out", async ({
  page,
}) => {
  const { generateKeyPair, SignJWT } = await import("jose");
  const keys = await generateKeyPair("RS256");
  const walletState = { ...walletFixture(), authMode: "auth0" };
  const subject = "paypal|returning-user";
  let authorization: URL | undefined;
  let idToken = "";
  let profileReads = 0;
  let bootstrapReads = 0;
  const timings: {
    mode: string;
    measures: { name: string; durationMs: number }[];
    bootstrapReads: number;
    browserProfileReads: number;
  }[] = [];
  const captureTimings = async (mode: string) => {
    await expect
      .poll(() =>
        page.evaluate(
          () => performance.getEntriesByName("dpb:dashboard_usable").length,
        ),
      )
      .toBeGreaterThan(0);
    timings.push({
      mode,
      measures: await page.evaluate(() =>
        performance
          .getEntriesByType("measure")
          .filter((e) => e.name.startsWith("dpb:"))
          .map((e) => ({
            name: e.name,
            durationMs: Math.round(e.duration * 10) / 10,
          })),
      ),
      bootstrapReads,
      browserProfileReads: profileReads,
    });
  };
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        auth0: {
          domain: "example.auth0.com",
          clientId: "wallet-test",
          databaseConnection: "database",
        },
        supabase: {
          url: "https://example.supabase.co",
          publishableKey: "public-key",
        },
      },
    }),
  );
  for (const path of ["bootstrap", "dashboard?**", "activity?**"])
    await page.route(`**/api/${path}`, (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${idToken}`);
      if (path === "bootstrap") bootstrapReads++;
      return route.fulfill({
        json: loadingResponse(
          new URL(route.request().url()).pathname.slice(4) +
            new URL(route.request().url()).search,
          walletState as State,
        ),
      });
    });
  await page.route(
    "https://example.supabase.co/rest/v1/profiles?**",
    (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${idToken}`);
      expect(new URL(route.request().url()).searchParams.get("auth0_sub")).toBe(
        `eq.${subject}`,
      );
      profileReads++;
      return route.fulfill({ json: { auth0_sub: subject } });
    },
  );
  await page.route("https://example.auth0.com/authorize?**", (route) => {
    authorization = new URL(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "Mock consent" });
  });
  await page.route("https://example.auth0.com/oauth/token", async (route) => {
    idToken = await new SignJWT({
      sub: subject,
      name: "Returning user",
      email: "user@example.com",
      role: "authenticated",
      nonce: authorization!.searchParams.get("nonce"),
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://example.auth0.com/")
      .setAudience("wallet-test")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);
    await route.fulfill({
      json: {
        access_token: "opaque-userinfo-token",
        id_token: idToken,
        refresh_token: "mock-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile email offline_access",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with PayPal" }).click();
  await expect.poll(() => !!authorization).toBe(true);
  const callback = new URL(authorization!.searchParams.get("redirect_uri")!);
  callback.searchParams.set("code", "mock-code");
  callback.searchParams.set("state", authorization!.searchParams.get("state")!);
  await page.goto(callback.toString());
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(profileReads).toBe(0);
  expect(bootstrapReads).toBe(1);
  await captureTimings("callback");
  await expect(page).toHaveURL(/\/#Home$/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(profileReads).toBe(0);
  expect(bootstrapReads).toBe(2);
  await captureTimings("refresh");
  writeFileSync(
    "test-results/startup-browser-after.json",
    JSON.stringify(
      {
        scenario:
          "controlled Auth0 SDK callback and cached session restoration; API responses mocked",
        timings,
      },
      null,
      2,
    ),
  );
  let logoutUrl: URL | undefined;
  await page.route("https://example.auth0.com/v2/logout?**", (route) => {
    logoutUrl = new URL(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "Mock logout" });
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => !!logoutUrl).toBe(true);
  expect(logoutUrl!.searchParams.get("returnTo")).toBe(callback.origin);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
