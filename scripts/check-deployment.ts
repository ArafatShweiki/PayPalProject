import "../server/env";
import {
  applicationOrigin,
  validateDeploymentConfiguration,
} from "../server/configuration";

try {
  validateDeploymentConfiguration({ ...process.env, VERCEL: "1" });
  const origin = applicationOrigin({ ...process.env, VERCEL: "1" });
  if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_CLIENT_ID)
    throw new Error("Configure AUTH0_DOMAIN and AUTH0_CLIENT_ID.");
  const credential = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
  if (
    !credential.project_id ||
    !credential.client_email ||
    !credential.private_key
  )
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT must contain the complete service-account JSON.",
    );
  const optional = [
    "CRON_SECRET",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_MERCHANT_ID",
    "GEMINI_API_KEY",
  ];
  console.log(
    JSON.stringify({
      ready: true,
      origin,
      optionalMissing: optional.filter((name) => !process.env[name]),
      liveServicesVerified: false,
    }),
  );
} catch (error) {
  // Never echo arbitrary provider credentials or JSON parsing error contents.
  console.error(
    error instanceof SyntaxError
      ? "FIREBASE_SERVICE_ACCOUNT must be valid JSON."
      : (error as Error).message,
  );
  process.exitCode = 1;
}
