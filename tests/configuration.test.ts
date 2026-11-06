import { expect, it } from "vitest";
import {
  applicationOrigin,
  validateDeploymentConfiguration,
  validateSupabaseConfiguration,
} from "../server/configuration";
import { databaseError } from "../server/database-errors";
const valid = {
  AUTH0_ENABLED: "true",
  SUPABASE_ENABLED: "true",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};
it("uses the exact HTTPS deployment origin and rejects unsafe callback destinations", () => {
  expect(applicationOrigin({})).toBe("http://127.0.0.1:5173");
  expect(
    applicationOrigin({ VERCEL: "1", VERCEL_URL: "preview.vercel.app" }),
  ).toBe("https://preview.vercel.app");
  expect(applicationOrigin({ APP_ORIGIN: "https://wallet.example/" })).toBe(
    "https://wallet.example",
  );
  for (const APP_ORIGIN of [
    "http://localhost:5173",
    "http://wallet.example",
    "https://wallet.example/path",
    "https://user:password@wallet.example",
    "https://wallet.example/?redirect=evil",
    "invalid",
  ])
    expect(() => applicationOrigin({ VERCEL: "1", APP_ORIGIN })).toThrow();
  expect(() => applicationOrigin({ NODE_ENV: "production" })).toThrow();
});
it("fails closed when a Vercel instance lacks authenticated durable storage", () => {
  const env = {
    ...valid,
    VERCEL: "1",
    APP_ORIGIN: "https://wallet.example",
    STORAGE: "firestore",
    FIREBASE_SERVICE_ACCOUNT: "configured",
  };
  expect(() => validateDeploymentConfiguration(env)).not.toThrow();
  for (const patch of [
    { STORAGE: "sqlite" },
    { FIREBASE_SERVICE_ACCOUNT: "" },
    { AUTH0_ENABLED: "false" },
    { SUPABASE_ENABLED: "false" },
  ])
    expect(() =>
      validateDeploymentConfiguration({ ...env, ...patch }),
    ).toThrow();
});
it("rejects missing configuration and accidental exposure of service credentials", () => {
  expect(() => validateSupabaseConfiguration(valid)).not.toThrow();
  for (const env of [
    { ...valid, SUPABASE_URL: "bad" },
    { ...valid, SUPABASE_SECRET_KEY: "" },
    { ...valid, AUTH0_ENABLED: "false" },
    { ...valid, SUPABASE_URL: "http://untrusted.test" },
    { ...valid, SUPABASE_PUBLISHABLE_KEY: valid.SUPABASE_SECRET_KEY },
    {
      ...valid,
      SUPABASE_PUBLISHABLE_KEY: `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`,
    },
  ])
    expect(() => validateSupabaseConfiguration(env)).toThrow();
});
it("maps database failures to useful messages without disclosing raw database details", () => {
  expect(
    databaseError({ code: "P0001", message: "Insufficient wallet balance" }),
  ).toMatchObject({
    status: 409,
    message: "Insufficient wallet balance for this operation.",
  });
  expect(
    databaseError({ code: "23505", message: "one_refund_per_purchase" })
      .message,
  ).toContain("already been refunded");
  const hidden = databaseError({
    code: "42501",
    message: "secret SQL details",
  });
  expect(hidden.status).toBe(503);
  expect(hidden.message).not.toContain("secret SQL");
});
