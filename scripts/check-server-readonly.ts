import "../server/env";
// Enable integration only inside this diagnostic process; do not edit .env.local.
process.env.SUPABASE_ENABLED = "true";
const { app } = await import("../server/app");
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
try {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Diagnostic server unavailable");
  const base = `http://127.0.0.1:${address.port}`;
  const config = await fetch(`${base}/api/config`);
  const raw = await config.text();
  const data = JSON.parse(raw);
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonymous = await fetch(`${base}/api/state`);
  const forged = await fetch(`${base}/api/state`, {
    headers: { Authorization: "Bearer invalid-token" },
  });
  const checks = {
    publicConfig:
      config.ok &&
      !!data.auth0 &&
      !!data.supabase?.publishableKey &&
      !raw.includes(secret!),
    anonymousDenied: anonymous.status === 401,
    forgedDenied: forged.status === 401,
    cspAllowsSupabase: config.headers
      .get("content-security-policy")
      ?.includes(new URL(process.env.SUPABASE_URL!).origin),
  };
  console.log(JSON.stringify(checks));
  if (Object.values(checks).some((value) => value !== true))
    process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
