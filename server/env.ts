import { config } from "dotenv";

// Deployment environment wins; local settings precede the existing fallback files.
if (
  process.env.NODE_ENV !== "test" &&
  process.env.WALLETWISE_LOAD_ENV !== "false"
)
  config({ path: [".env.local", ".env", ".env.auth0"], quiet: true });
