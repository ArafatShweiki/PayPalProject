export const PRODUCTION_ORIGIN = "https://pay-pal-project.vercel.app";
export type LiveMode = "production-smoke" | "preview-e2e";
export type Target = {
  mode: LiveMode;
  origin: string;
  databaseOrigin?: string;
  auth0Origin?: string;
  auth0ClientId?: string;
  mutationReady?: true;
};
export class SafetyError extends Error {
  constructor() {
    super(
      "LIVE SAFETY GUARD: request or environment is not authorized; no request was sent.",
    );
  }
}
export function origin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new SafetyError();
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  return u.origin;
}
export function previewTarget(
  value: string,
  database: string,
  productionDatabase: string,
  project: string,
): Target {
  const app = origin(value),
    db = origin(database),
    prodDb = origin(productionDatabase);
  if (
    app === PRODUCTION_ORIGIN ||
    db === prodDb ||
    !/^[a-z0-9]{10,40}$/.test(project) ||
    db !== `https://${project}.supabase.co` ||
    new URL(app).hostname.endsWith(".supabase.co")
  )
    throw new SafetyError();
  return { mode: "preview-e2e", origin: app, databaseOrigin: db };
}
const forbiddenProductionGet =
  /^\/api\/(?:cron|bootstrap|rates\/(?:live|refresh)|market-data\/live)(?:\/|$)/;
const productionApiReads =
  /^\/api\/(?:config|state|dashboard|activity|account\/reports|funding|onboarding|savings\/options|circles(?:\/invitations\/[A-Za-z0-9_-]{43}|\/[a-f0-9-]{36}|\/invite\/[A-Za-z0-9_-]{43})?|rates\/history)$/;
const previewMutations =
  /^\/api\/(?:onboarding|logout|purchases|refunds|preferences|savings\/(?:default|destination|preview|assign)|goals(?:\/[a-f0-9-]{36})?|conversions(?:\/preview)?|alerts(?:\/[a-f0-9-]{36})?|notifications\/read|rates\/(?:refresh|insight)|reports|recommendations\/[a-f0-9-]{36}|funding(?:\/orders|\/[a-f0-9-]{36}\/(?:capture|reconcile|cancel))|circles(?:\/join|\/[a-f0-9-]{36}\/(?:invite|contribute|actions))?)$/;
export function assertRequest(
  target: Target,
  method: string,
  value: string,
  authorization = "",
) {
  const u = new URL(value),
    host = u.hostname.toLowerCase().replace(/\.$/, ""),
    requestOrigin = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
  if (u.protocol !== "https:" || u.username || u.password)
    throw new SafetyError();
  const path = decodeURIComponent(u.pathname).replace(/\/+/g, "/");
  if (target.mode === "production-smoke") {
    if (
      !["GET", "HEAD"].includes(method.toUpperCase()) ||
      requestOrigin !== PRODUCTION_ORIGIN ||
      forbiddenProductionGet.test(path)
    )
      throw new SafetyError();
    // No credentials/session restoration in Production. Deliberately invalid
    // tokens are allowed only for the signed-out authentication rejection test.
    if (
      authorization &&
      authorization !== "Bearer live-smoke-invalid" &&
      authorization !== "Bearer eyJhbGciOiJub25lIn0.eyJleHAiOjF9."
    )
      throw new SafetyError();
    if (path.startsWith("/api") && !productionApiReads.test(path))
      throw new SafetyError();
    return;
  }
  if (
    target.origin === PRODUCTION_ORIGIN ||
    requestOrigin === PRODUCTION_ORIGIN
  )
    throw new SafetyError();
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
    !target.mutationReady
  )
    throw new SafetyError();
  if (requestOrigin === target.origin) {
    if (path.startsWith("/api/cron")) throw new SafetyError();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
      !previewMutations.test(path)
    )
      throw new SafetyError();
    return;
  }
  if (requestOrigin === target.auth0Origin) {
    if (
      path === "/authorize" &&
      (u.searchParams.get("redirect_uri") !== target.origin ||
        u.searchParams.get("client_id") !== target.auth0ClientId)
    )
      throw new SafetyError();
    if (/signup|change_password/.test(path)) throw new SafetyError();
    return;
  }
  if (
    requestOrigin === target.databaseOrigin &&
    ["GET", "HEAD"].includes(method.toUpperCase())
  )
    return;
  if (
    (host === "www.sandbox.paypal.com" ||
      host.endsWith(".sandbox.paypal.com")) &&
    target.mode === "preview-e2e"
  )
    return;
  if (
    host.endsWith(".paypalobjects.com") &&
    ["GET", "HEAD"].includes(method.toUpperCase())
  )
    return;
  if (
    ["cdn.auth0.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(
      host,
    ) &&
    ["GET", "HEAD"].includes(method.toUpperCase())
  )
    return;
  throw new SafetyError();
}
export function safePath(value: string) {
  try {
    return new URL(value).pathname
      .replace(/\/circles\/invite\/[^/]+/g, "/circles/invite/[redacted]")
      .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[id]")
      .replace(/\/[A-Za-z0-9_-]{32,}/g, "/[id]");
  } catch {
    return "[redacted-url]";
  }
}
