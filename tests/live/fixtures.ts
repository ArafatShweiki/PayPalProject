import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { assertRequest, safePath, type Target } from "./safety";
import { production, safeSend, type SafeResponse } from "./environment";
import { saveSanitizedTrace } from "./artifacts";

type Evidence = {
  violations: { method: string; path: string }[];
  consoleErrors: string[];
  failures: { method: string; path: string; status?: number }[];
  expected: Set<string>;
};
export async function guardContext(
  context: BrowserContext,
  target: Target,
  evidence: Evidence,
) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    try {
      assertRequest(
        target,
        req.method(),
        req.url(),
        req.headers().authorization || "",
      );
    } catch {
      evidence.violations.push({
        method: req.method(),
        path: safePath(req.url()),
      });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    evidence.violations.push({
      method: "WEBSOCKET",
      path: safePath(socket.url()),
    });
    socket.close();
  });
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        const path = safePath(message.location().url || "");
        if (!evidence.expected.has(path))
          evidence.consoleErrors.push(
            `Console error at ${path}; text withheld.`,
          );
      }
    });
    page.on("pageerror", () =>
      evidence.consoleErrors.push(
        "Unhandled browser exception; details withheld.",
      ),
    );
    page.on("response", (response) => {
      const req = response.request();
      if (
        response.status() >= 400 &&
        ["script", "stylesheet", "document"].includes(req.resourceType())
      )
        evidence.failures.push({
          method: req.method(),
          path: safePath(req.url()),
          status: response.status(),
        });
    });
    page.on("requestfailed", (req) => {
      if (
        ["script", "stylesheet", "document"].includes(req.resourceType()) &&
        !req.failure()?.errorText.includes("ERR_ABORTED")
      )
        evidence.failures.push({
          method: req.method(),
          path: safePath(req.url()),
        });
    });
  });
}
export async function safeScreenshot(
  page: Page,
  info: TestInfo,
  label: string,
  privatePage = false,
) {
  const file = info.outputPath(`${label}.png`);
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: "disabled",
    mask: privatePage
      ? [
          page.locator("main"),
          page.locator("header"),
          page.locator("input"),
          page.locator("dialog"),
          page.locator('[class*="profile"]'),
          page.locator('[role="alert"], [role="status"]'),
        ]
      : [],
  });
  await info.attach(label, { path: file, contentType: "image/png" });
}
export const test = base.extend<{
  evidence: Evidence;
  api: (
    method: string,
    path: string,
    token?: string,
  ) => Promise<SafeResponse<unknown>>;
}>({
  evidence: async ({}, use) => {
    await use({
      violations: [],
      consoleErrors: [],
      failures: [],
      expected: new Set(),
    });
  },
  api: async ({}, use, info) => {
    const calls: { method: string; path: string; status: number }[] = [];
    await use(async (method, path, token) => {
      const response = await safeSend(production, method, path, token);
      calls.push({
        method,
        path: safePath(new URL(path, production.origin).href),
        status: response.status,
      });
      return response;
    });
    await info.attach("read-only-api-summary", {
      body: JSON.stringify(calls),
      contentType: "application/json",
    });
  },
  context: async ({ browser, evidence }, use, info) => {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 1000 },
    });
    await guardContext(context, production, evidence);
    await context.tracing.start({
      screenshots: false,
      snapshots: false,
      sources: false,
    });
    try {
      await use(context);
    } finally {
      mkdirSync(".temp", { recursive: true });
      const privateDir = mkdtempSync(resolve(".temp/live-trace-"));
      const raw = join(privateDir, "raw.zip");
      await context.tracing.stop({ path: raw });
      if (info.status !== info.expectedStatus) {
        const output = info.outputPath("redacted-trace.zip");
        saveSanitizedTrace(raw, output);
        await info.attach("redacted-trace", {
          path: output,
          contentType: "application/zip",
        });
        const page = context.pages()[0];
        if (page)
          await safeScreenshot(page, info, "failure", false).catch(() => {});
      } else {
        // Use the same sanitizer/disposal path even when no trace is attached.
        saveSanitizedTrace(raw, join(privateDir, "redacted.zip"));
      }
      await info.attach("safe-network-summary", {
        body: JSON.stringify({
          violations: evidence.violations,
          consoleErrors: evidence.consoleErrors,
          failures: evidence.failures,
        }),
        contentType: "application/json",
      });
      await context.close();
      expect(
        evidence.violations.length,
        "Production safety guard rejected a request; none was sent.",
      ).toBe(0);
      expect(
        evidence.failures.length,
        "Critical resource requests failed; see redacted summary.",
      ).toBe(0);
      expect(
        evidence.consoleErrors.length,
        "Unexpected browser console errors; text withheld.",
      ).toBe(0);
    }
  },
  // Raw APIRequestContext bypasses browser routing. Do not expose one in smoke
  // tests; every API call must use safeSend, which validates before fetch.
  request: async ({}, use) => {
    await use(
      new Proxy(
        {},
        {
          get() {
            throw new Error(
              "Use safeSend; unguarded APIRequestContext is disabled for Production smoke.",
            );
          },
        },
      ) as never,
    );
  },
});
export { expect, safeSend, production };
