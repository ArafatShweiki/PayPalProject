import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 4,
  use: { baseURL: "http://127.0.0.1:5187", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx server/index.ts",
      url: "http://127.0.0.1:3101/api/config",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        WALLETWISE_LOAD_ENV: "false",
        AUTH0_ENABLED: "false",
        SUPABASE_ENABLED: "false",
        STORAGE: "sqlite",
        PORT: "3101",
        APP_ORIGIN: "http://127.0.0.1:5187",
        GEMINI_API_KEY: "",
        PAYPAL_CLIENT_ID: "",
        PAYPAL_CLIENT_SECRET: "",
        DATABASE_PATH: "data/e2e.db",
        DISABLE_RATE_JOB: "true",
      },
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5187 --strictPort",
      env: {
        WALLETWISE_API_TARGET: "http://127.0.0.1:3101",
      },
      url: "http://127.0.0.1:5187",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
