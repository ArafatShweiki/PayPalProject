import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/production",
  outputDir: "test-results-production",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5194", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start:preview",
    url: "http://127.0.0.1:5194/api/config",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      WALLETWISE_LOAD_ENV: "false",
      AUTH0_ENABLED: "true",
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_CLIENT_ID: "production-smoke-client",
      SUPABASE_ENABLED: "false",
      STORAGE: "sqlite",
      DATABASE_PATH: "data/production-smoke.db",
      APP_ORIGIN: "https://wallet.example.test",
      PORT: "5194",
    },
  },
});
