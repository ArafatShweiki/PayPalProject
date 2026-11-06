import { startStage, finishStage } from "./performance";
import {
  abortable,
  privateRequests,
  publicRequests,
  cacheScope,
  clearPrivateCache,
} from "./requestCache";
import { ApiError, userFacingMessage } from "./errors";
let auth0Token: (() => Promise<string>) | undefined;
export function setAuth0TokenProvider(provider?: () => Promise<string>) {
  clearPrivateCache();
  cooldowns.clear();
  auth0Token = provider;
}
const cooldowns = new Map<string, number>();
const configuredTtl = Number(import.meta.env.VITE_STATE_STALE_MS ?? 1500);
const stateTtl = Number.isFinite(configuredTtl)
  ? Math.max(0, Math.min(10000, configuredTtl))
  : 1500;
export function requestTimeoutMs(path: string) {
  if (path === "/bootstrap") return 12000;
  // Capture/reconciliation can perform several sequential bounded provider calls.
  // A longer client deadline never retries a financial mutation automatically.
  if (path.startsWith("/funding")) return 180000;
  if (path === "/reports") return 60000;
  return 20000;
}
async function readJson(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(
      "Unable to load your information. Please try again shortly.",
      503,
    );
  const result = await response.json();
  if (!response.ok) {
    const seconds = Math.max(
      1,
      Number(response.headers.get("retry-after")) || 60,
    );
    throw new ApiError(
      response.status === 429
        ? `Too many requests. Please try again in ${seconds} seconds.`
        : userFacingMessage(
            typeof result.error === "string"
              ? result.error
              : "Request could not be completed.",
          ),
      response.status,
      response.status === 429 ? seconds : 0,
      response.headers.get("x-request-id") || undefined,
    );
  }
  return result;
}
export async function configuration() {
  return publicRequests.get("config", 60000, async (signal) => {
    const deadline = AbortSignal.timeout(12000);
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch("/api/config", {
          signal: AbortSignal.any([
            signal,
            deadline,
            AbortSignal.timeout(6000),
          ]),
          cache: "no-store",
        });
        return await readJson(response);
      } catch (error) {
        if (
          signal.aborted ||
          deadline.aborted ||
          attempt >= 1 ||
          (error instanceof ApiError && error.status < 500)
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 400 * (attempt + 1)),
        );
      }
    }
  });
}
export async function logout() {
  try {
    await api("/logout", {});
  } finally {
    clearPrivateCache();
    cooldowns.clear();
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const scope = cacheScope();
  const key = `${scope}:${path}`;
  const until = cooldowns.get(key) || 0;
  if (until > Date.now())
    throw new ApiError(
      `Too many requests. Please try again in ${Math.ceil((until - Date.now()) / 1000)} seconds.`,
      429,
      Math.ceil((until - Date.now()) / 1000),
    );
  const mutation = body !== undefined;
  const request = async (signal: AbortSignal): Promise<T> => {
    const deadline = AbortSignal.timeout(requestTimeoutMs(path));
    const tokenDeadline = AbortSignal.timeout(8000);
    let token: string | undefined;
    try {
      startStage("identity_token");
      token = auth0Token
        ? await abortable(
            auth0Token(),
            AbortSignal.any([signal, deadline, tokenDeadline]),
          )
        : undefined;
      finishStage("identity_token");
      if (!token) throw new Error("Sign in required");
    } catch {
      if (signal.aborted)
        throw new DOMException("Obsolete request", "AbortError");
      if (tokenDeadline.aborted || deadline.aborted)
        throw new ApiError(
          "Sign-in verification took too long. Please try again.",
          503,
        );
      throw new ApiError("Your session expired. Please sign in again.", 401);
    }
    if (scope !== cacheScope())
      throw new DOMException("Account changed", "AbortError");
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`/api${path}`, {
          method: mutation ? method : "GET",
          cache: "no-store",
          signal: AbortSignal.any([signal, deadline]),
          headers: {
            "Content-Type": "application/json",
            "X-WalletWise": "1",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(mutation ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status === 403) {
          const preview = await response
            .clone()
            .json()
            .catch(() => ({}));
          if (preview.code === "ONBOARDING_REQUIRED")
            window.dispatchEvent(new Event("walletwise:onboarding-required"));
        }
        const result = await readJson(response);
        if (scope !== cacheScope())
          throw new DOMException("Account changed", "AbortError");
        return result as T;
      } catch (error) {
        if (error instanceof ApiError && error.status === 429)
          cooldowns.set(key, Date.now() + error.retryAfter * 1000);
        if (signal.aborted) throw error;
        if (
          !mutation &&
          attempt === 0 &&
          !deadline.aborted &&
          !(error instanceof ApiError)
        )
          continue;
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          "The request timed out or the network is unavailable. Please try again.",
          503,
        );
      }
    }
  };
  if (!mutation)
    return privateRequests.get(
      key,
      /^(?:\/state|\/bootstrap|\/dashboard|\/activity)/.test(path)
        ? stateTtl
        : 0,
      request,
      options.signal,
    );
  // Never cache or retry writes. Invalidate reads on either side of every mutation.
  privateRequests.clear();
  try {
    return await request(new AbortController().signal);
  } finally {
    privateRequests.clear();
  }
}
