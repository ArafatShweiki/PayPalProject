import { defineConfig, devices } from "@playwright/test";
const preview = process.argv.some(
  (arg) => arg === "preview-e2e" || arg === "--project=preview-e2e",
);
const mode = preview ? "preview-e2e" : "production-smoke";
export default defineConfig({
  testDir: "tests/live",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  outputDir: `test-results-live/${mode}`,
  // Redaction runs before list/HTML reporters receive errors or step titles.
  reporter: [
    ["./tests/live/reporter.ts"],
    ["list"],
    ["html", { outputFolder: `playwright-report-live/${mode}`, open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    acceptDownloads: false,
  },
  projects: [
    preview
      ? { name: "preview-e2e", testMatch: "preview.spec.ts", timeout: 180000 }
      : { name: "production-smoke", testMatch: "smoke.spec.ts" },
  ],
});
