import { clearPrivateCache } from "./requestCache";
// This gate is folded to false by Vite in every production build.
export const demoEnabled = () =>
  import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MODE === "true";
export const DEMO_STORAGE_KEY = "walletwise:developer-demo:v1";
type DemoTransport = (path: string, body?: unknown, method?: string) => unknown;
let transport: DemoTransport | undefined;
export const isDemoActive = () => demoEnabled() && !!transport;
export function setDemoTransport(next?: DemoTransport) {
  if (next && !demoEnabled())
    throw new Error("Developer Demo Mode is disabled.");
  clearPrivateCache();
  transport = next;
}
export function demoRequest(path: string, body?: unknown, method?: string) {
  if (!isDemoActive()) throw new Error("No developer demo session.");
  return transport!(path, body, method);
}
export function clearDemoSession() {
  clearPrivateCache();
  transport = undefined;
  try {
    sessionStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    /* Storage may be blocked; in-memory session is already cleared. */
  }
}

export function hasDemoSession() {
  if (!demoEnabled()) return false;
  try {
    const params = new URLSearchParams(location.search);
    if (params.has("code") && params.has("state")) {
      clearDemoSession();
      return false;
    }
    return !!sessionStorage.getItem(DEMO_STORAGE_KEY);
  } catch {
    return false;
  }
}
