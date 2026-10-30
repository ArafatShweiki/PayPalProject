import {
  privateRequests,
  publicRequests,
  cacheScope,
  clearPrivateCache,
} from "./requestCache";
import { ApiError, userFacingMessage } from "./errors";
import { demoRequest, isDemoActive } from "./demoSession";
import type { Auth } from "firebase/auth";
let auth: Auth | undefined;
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
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch("/api/config", {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          cache: "no-store",
        });
        return await readJson(response);
      } catch (error) {
        if (
          signal.aborted ||
          attempt >= 2 ||
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
export async function initAuth() {
  if (isDemoActive() || auth0Token) return false;
  const config = await configuration();
  if (config.firebase) {
    const [{ initializeApp }, { getAuth, onAuthStateChanged }] =
      await Promise.all([import("firebase/app"), import("firebase/auth")]);
    auth = getAuth(initializeApp(config.firebaseConfig));
    await new Promise<void>((resolve) => {
      const off = onAuthStateChanged(auth!, () => {
        off();
        resolve();
      });
    });
  }
  return config.firebase as boolean;
}
export async function login(
  email: string,
  password: string,
  register: boolean,
) {
  if (isDemoActive()) throw new Error("Exit Demo Mode before signing in.");
  if (!auth)
    throw new Error(
      "Sign-in is currently unavailable. Please try again later.",
    );
  const { createUserWithEmailAndPassword, signInWithEmailAndPassword } =
    await import("firebase/auth");
  await (
    register ? createUserWithEmailAndPassword : signInWithEmailAndPassword
  )(auth, email, password);
  clearPrivateCache();
  cooldowns.clear();
}
export async function logout() {
  if (isDemoActive())
    throw new Error("Use Exit Demo Mode to end the local session.");
  try {
    await api("/logout", {});
  } finally {
    clearPrivateCache();
    cooldowns.clear();
    if (auth) {
      const { signOut } = await import("firebase/auth");
      await signOut(auth);
    }
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  if (isDemoActive()) return demoRequest(path, body, method) as T;
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
    let token: string | undefined;
    try {
      token = auth0Token
        ? await auth0Token()
        : await auth?.currentUser?.getIdToken();
    } catch {
      throw new ApiError("Your session expired. Please sign in again.", 401);
    }
    if (scope !== cacheScope())
      throw new DOMException("Account changed", "AbortError");
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`/api${path}`, {
          method: mutation ? method : "GET",
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
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
        return (await readJson(response)) as T;
      } catch (error) {
        if (error instanceof ApiError && error.status === 429)
          cooldowns.set(key, Date.now() + error.retryAfter * 1000);
        if (signal.aborted) throw error;
        if (!mutation && attempt === 0 && !(error instanceof ApiError))
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
    return privateRequests.get(key, path === "/state" ? stateTtl : 0, request);
  // Never cache or retry writes. Invalidate reads on either side of every mutation.
  privateRequests.clear();
  try {
    return await request(new AbortController().signal);
  } finally {
    privateRequests.clear();
  }
}
