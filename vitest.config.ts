import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Bound concurrent SDK/PostgreSQL workers for cold installs and CI hosts.
    // Keep existing assertions and timeouts unchanged.
    maxWorkers: 4,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    env: {
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
