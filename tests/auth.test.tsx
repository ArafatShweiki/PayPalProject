import { profileBootstrap } from "./fixtures/loading";
import { configureSupabase } from "../src/supabase";
// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  AuthGate,
  AuthScreen,
  safeReturnTo,
  type AuthConfig,
} from "../src/Auth";
const auth = vi.hoisted(() => ({
  isLoading: false,
  isAuthenticated: false,
  error: undefined as { error: string; message: string } | undefined,
  loginWithRedirect: vi.fn(),
  getAccessTokenSilently: vi.fn(),
  getIdTokenClaims: vi.fn(),
  logout: vi.fn(),
  user: undefined as { sub: string } | undefined,
}));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth,
  Auth0Provider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../src/App", () => ({ App: () => <p>Private wallet</p> }));
const config: AuthConfig = {
  domain: "example.auth0.com",
  clientId: "public",
  databaseConnection: "database",
};
beforeEach(() => {
  vi.clearAllMocks();
  configureSupabase(null);
  auth.user = undefined;
  auth.logout.mockResolvedValue(undefined);
  auth.getIdTokenClaims.mockImplementation(async () => ({
    sub: auth.user?.sub,
    __raw: "id-token",
    role: "authenticated",
    exp: Date.now() / 1000 + 3600,
  }));
  auth.isLoading = false;
  auth.isAuthenticated = false;
  auth.error = undefined;
  auth.getAccessTokenSilently.mockResolvedValue("test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          profileBootstrap({
            complete: true,
            fullName: "Test",
            email: "fixture@example.invalid",
            emailVerified: false,
            preferred: "USD",
            savings: "disabled",
            notifications: false,
          }),
        ),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  configureSupabase(null);
  vi.unstubAllGlobals();
});
it("provides recovery if SDK restoration stalls instead of showing private data or waiting forever", async () => {
  vi.useFakeTimers();
  auth.isLoading = true;
  render(<AuthGate config={config} />);
  await React.act(async () => {
    vi.advanceTimersByTime(15001);
  });
  expect(
    screen.getByText("Sign-in is taking longer than expected."),
  ).toBeTruthy();
  expect(screen.queryByText("Private wallet")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("does not mount private wallet content while loading or signed out", () => {
  auth.isLoading = true;
  const view = render(<AuthGate config={config} />);
  expect(screen.queryByText("Private wallet")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  auth.isLoading = false;
  view.rerender(<AuthGate config={config} />);
  expect(screen.getByText("Welcome back.")).toBeTruthy();
  expect(screen.queryByText("Private wallet")).toBeNull();
});
it("mounts the wallet only after the token provider is ready", async () => {
  auth.isAuthenticated = true;
  render(<AuthGate config={config} />);
  expect(await screen.findByText("Private wallet")).toBeTruthy();
});
it.each(["login", "signup"])(
  "uses PayPal Sandbox and removes Google on %s",
  async (mode) => {
    render(<AuthScreen config={config} />);
    if (mode === "signup")
      fireEvent.click(screen.getByText("Create an account"));
    expect(screen.queryByText("Continue with Google")).toBeNull();
    fireEvent.click(screen.getByText("Continue with PayPal"));
    await waitFor(() =>
      expect(auth.loginWithRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          appState: { returnTo: "/#Home" },
          authorizationParams: { connection: "paypal-sandbox" },
        }),
      ),
    );
  },
);
it.each([
  ["access_denied", "User denied access", "We couldn't sign you in"],
  [
    "invalid_request",
    "the connection is not enabled",
    "This sign-in option is unavailable",
  ],
])(
  "handles Auth0 callback error %s without opening the wallet",
  async (code, message, expected) => {
    auth.error = { error: code, message };
    render(<AuthGate config={config} />);
    expect(screen.getByRole("alert").textContent).toContain(expected);
    expect(screen.queryByText("Private wallet")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continue with email" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with PayPal" }),
    );
    await waitFor(() => expect(auth.loginWithRedirect).toHaveBeenCalled());
  },
);
it("shows PayPal progress and recovers when returning with the browser back button", () => {
  auth.loginWithRedirect.mockReturnValueOnce(new Promise(() => {}));
  render(<AuthScreen config={config} />);
  fireEvent.click(screen.getByText("Continue with PayPal"));
  expect(screen.getByRole("status").textContent).toContain(
    "Opening PayPal sign-in",
  );
  expect(
    screen.getByText("PayPal sign-in is for test accounts only."),
  ).toBeTruthy();
  expect(screen.queryByText(/PayPal Sandbox/i)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: /Connecting to PayPal/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent(window, new Event("pageshow"));
  expect(
    screen
      .getByRole("button", { name: "Continue with PayPal" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("requests hosted registration without collecting a password", async () => {
  render(<AuthScreen config={config} />);
  fireEvent.click(screen.getByText("Create an account"));
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() =>
    expect(auth.loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: {
          connection: "database",
          screen_hint: "signup",
          login_hint: "person@example.com",
        },
      }),
    ),
  );
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
it("shows retryable login failures", async () => {
  auth.loginWithRedirect.mockRejectedValueOnce(new Error("network"));
  render(<AuthScreen config={config} />);
  fireEvent.click(screen.getByText("Continue with PayPal"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Continue with PayPal" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("sends database reset requests and gives a non-enumerating success message", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetcher);
  render(<AuthScreen config={config} resetOnly />);
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByText("Send reset link"));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith(
    "https://example.auth0.com/dbconnections/change_password",
    expect.objectContaining({
      body: JSON.stringify({
        client_id: "public",
        connection: "database",
        email: "person@example.com",
      }),
    }),
  );
});
it("rejects external and malformed redirect destinations", () => {
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/#unknown",
    undefined,
  ])
    expect(safeReturnTo(value)).toBe("/#Home");
  expect(safeReturnTo("/#My%20Wallet")).toBe("/#My%20Wallet");
  const invitation = `/circles/invite/${"a".repeat(43)}`;
  expect(safeReturnTo(invitation)).toBe(invitation);
  expect(safeReturnTo(`${invitation}/../settings`)).toBe("/#Home");
  expect(safeReturnTo(`${invitation}?redirect=https://evil.test`)).toBe(
    "/#Home",
  );
});

it("blocks private content when the verified backend cannot load the account", async () => {
  auth.isAuthenticated = true;
  auth.user = { sub: "auth0|current" };
  configureSupabase({
    url: "https://example.supabase.co",
    publishableKey: "public-test-key",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Account unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  render(<AuthGate config={config} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Private wallet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Sign out$/ }));
  await waitFor(() => expect(auth.logout).toHaveBeenCalled());
});
it("removes private content when switching accounts until the new onboarding check finishes", async () => {
  auth.isAuthenticated = true;
  auth.user = { sub: "auth0|first" };
  const view = render(<AuthGate config={config} />);
  await screen.findByText("Private wallet");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  auth.user = { sub: "auth0|second" };
  view.rerender(<AuthGate config={config} />);
  await waitFor(() => expect(screen.queryByText("Private wallet")).toBeNull());
});

it("loads a returning account with one ID-token bootstrap and no redundant browser profile query", async () => {
  auth.isAuthenticated = true;
  auth.user = { sub: "paypal|returning" };
  configureSupabase({
    url: "https://example.supabase.co",
    publishableKey: "public-test-key",
  });
  const requests: Array<{ url: string; bearer: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        bearer: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(
        JSON.stringify(
          String(input).includes("supabase.co")
            ? { auth0_sub: "paypal|returning" }
            : profileBootstrap({
                complete: true,
                fullName: "Test",
                email: "fixture@example.invalid",
                emailVerified: false,
                preferred: "USD",
                savings: "disabled",
                notifications: false,
              }),
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  render(<AuthGate config={config} />);
  expect(await screen.findByText("Private wallet")).toBeTruthy();
  expect(requests).toHaveLength(1);
  expect(requests.every((r) => r.bearer === "Bearer id-token")).toBe(true);
  expect(requests[0].url).toBe("/api/bootstrap");
  expect(auth.getAccessTokenSilently).not.toHaveBeenCalled();
});
it("blocks the wallet when ID token renewal fails", async () => {
  auth.isAuthenticated = true;
  auth.user = { sub: "auth0|expired" };
  configureSupabase({
    url: "https://example.supabase.co",
    publishableKey: "public-test-key",
  });
  auth.getIdTokenClaims.mockResolvedValue({
    __raw: "expired",
    role: "authenticated",
    exp: 1,
  });
  auth.getAccessTokenSilently.mockRejectedValueOnce(
    new Error("login_required"),
  );
  render(<AuthGate config={config} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Private wallet")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
