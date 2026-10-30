import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    env: {
      ALLOW_DEMO: "true",
      RATE_LIMIT_ENTRY: "10000",
      RATE_LIMIT_READ: "10000",
      STORAGE: "sqlite",
      AUTH0_ENABLED: "false",
      SUPABASE_ENABLED: "false",
      DATABASE_PATH: "data/test.db",
      DISABLE_RATE_JOB: "true",
    },
  },
});
