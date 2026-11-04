import "../server/env";
const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const required = [
  "/rpc/walletwise_goal_purchase",
  "/rpc/walletwise_set_savings_destination",
  "/rpc/walletwise_savings_options",
  "/rpc/walletwise_circle_command",
  "/rpc/walletwise_circle_contribute",
  "/rpc/walletwise_circles",
  "/rpc/walletwise_invitation_preview",
  "/rpc/walletwise_invitation_status",
  "/rpc/walletwise_join_circle",
  "/rpc/walletwise_goal_refund",
  "/rpc/walletwise_own_circle_ledger",
  "/savings_circles",
  "/goal_savings_entries",
  "/savings_quotes",
];
try {
  if (!url || !key) throw new Error("Configuration missing");
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Schema unavailable");
  const schema = await response.json();
  const missing = required.filter((path) => !schema.paths?.[path]);
  console.log(
    JSON.stringify(
      {
        ready: missing.length === 0,
        missing,
        migration: "202611010001_circle_invitation_membership.sql",
        readOnly: true,
      },
      null,
      2,
    ),
  );
  if (missing.length) process.exitCode = 1;
} catch {
  console.error(
    "Savings schema check could not connect. Check server-side Supabase configuration.",
  );
  process.exitCode = 1;
}
