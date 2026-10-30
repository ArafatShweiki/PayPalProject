import { CardSkeleton, PageSkeleton } from "./Skeleton";
import { clearPrivateCache } from "./requestCache";
import {
  clearDemoSession,
  hasDemoSession,
  demoEnabled,
  setDemoTransport,
} from "./demoSession";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ArrowRight, Leaf, Wallet } from "lucide-react";
const WalletApp = lazy(() =>
  import("./App").then((module) => ({ default: module.App })),
);
function App(props: ComponentProps<typeof import("./App").App>) {
  return (
    <Suspense
      fallback={
        <main className="wallet-loading">
          <h1 role="status">Getting your wallet ready...</h1>
          <PageSkeleton />
        </main>
      }
    >
      <WalletApp {...props} />
    </Suspense>
  );
}
import { OnboardingBoundary } from "./Onboarding";
import { api, configuration, setAuth0TokenProvider } from "./api";
import { Button } from "./ui";
import {
  auth0IdTokenProvider,
  configureSupabase,
  getBrowserSupabase,
  setSupabaseIdTokenProvider,
} from "./supabase";
export type AuthConfig = {
  domain: string;
  clientId: string;
  databaseConnection: string;
};
export function authenticationError(error: unknown): string {
  const detail =
    error && typeof error === "object"
      ? (error as {
          error?: string;
          error_description?: string;
          message?: string;
        })
      : {};
  const code = detail.error || "";
  const description = (detail.error_description || detail.message || "").trim();
  if (
    /service not found|not authorized to access resource server/i.test(
      description,
    )
  )
    return "We couldn't sign you in. Please try again later.";
  if (
    code === "user_cancelled" ||
    /user (has )?(canceled|cancelled)|interaction (was )?cancelled/i.test(
      description,
    )
  )
    return "You cancelled PayPal sign-in. You can try again or continue with email.";
  if (
    /connection.*(not enabled|not found|disabled|does not exist)/i.test(
      description,
    )
  )
    return "This sign-in option is unavailable. Please continue with email.";
  if (code === "access_denied" || code === "unauthorized") {
    if (/action.*denied|denied.*action/i.test(description))
      return "We couldn't sign you in with this account. Please try another sign-in option.";
    return "We couldn't sign you in. Please try again or continue with email.";
  }
  if (description && /connection|provider|paypal/i.test(description))
    return "We couldn't complete PayPal sign-in. Please try again or continue with email.";
  return "We could not complete sign-in. Please try again or continue with email.";
}
export function safeReturnTo(value?: string) {
  // Existing Dream Piggy Bank routes are hash based; never accept an external return URL.
  return /^\/#(?:Home|My%20Wallet|Smart%20Savings|Currency%20Rates|Reports|Settings)$/.test(
    value || "",
  )
    ? value!
    : "/#Home";
}
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          Dream Piggy Bank<span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow">A LITTLE CLARITY. EVERY DAY.</span>
          <h1>
            Your money,
            <br />
            in perspective.
          </h1>
          <div className="auth-feature">
            <Leaf size={22} />
            <p>
              Turn small change into meaningful progress with Smart Savings.
            </p>
          </div>
        </div>
      </section>
      <section className="auth-card">{children}</section>
    </main>
  );
}
export function AuthScreen({
  config,
  initialError = "",
  resetOnly = false,
  onDemo,
}: {
  config: AuthConfig;
  initialError?: string;
  resetOnly?: boolean;
  onDemo?: () => void;
}) {
  const { loginWithRedirect } = useAuth0();
  const [mode, setMode] = useState<"login" | "signup" | "reset">(
    resetOnly ? "reset" : "login",
  );
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState("");
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    setError(initialError);
  }, [initialError]);
  useEffect(() => {
    const resume = () => {
      setBusy(false);
      setConnecting("");
    };
    window.addEventListener("pageshow", resume);
    return () => window.removeEventListener("pageshow", resume);
  }, []);
  async function login(connection: string) {
    if (busy) return;
    setConnecting(connection);
    setBusy(true);
    setError("");
    try {
      await loginWithRedirect({
        appState: { returnTo: safeReturnTo(location.pathname + location.hash) },
        authorizationParams: {
          connection,
          ...(mode === "signup" && connection === config.databaseConnection
            ? { screen_hint: "signup" }
            : {}),
          ...(email && connection === config.databaseConnection
            ? { login_hint: email }
            : {}),
        },
      });
    } catch (error) {
      setError(authenticationError(error));
      setConnecting("");
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `https://${config.domain}/dbconnections/change_password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: config.clientId,
            connection: config.databaseConnection,
            email,
          }),
        },
      );
      if (!response.ok) throw new Error();
      setSuccess(
        "If an email/password account exists for this address, you’ll receive a password reset link. Check your inbox and spam folder.",
      );
    } catch {
      setError(
        "We couldn’t request a reset. Try again, or choose Forgot password on the secure sign-in screen.",
      );
    } finally {
      setBusy(false);
    }
  }
  function switchMode(next: typeof mode) {
    setMode(next);
    setError("");
    setSuccess("");
  }
  const Layout = resetOnly ? "div" : AuthLayout;
  return (
    <Layout>
      <span className="eyebrow">YOUR DREAM PIGGY BANK ACCOUNT</span>
      <h2>
        {mode === "signup"
          ? "A fresh start for your finances."
          : mode === "reset"
            ? "Let’s get you back in."
            : "Welcome back."}
      </h2>
      <p>
        {mode === "signup"
          ? "Create your account and make room for small wins."
          : mode === "reset"
            ? "Enter the email you used to create your account."
            : "Sign in to pick up where you left off."}
      </p>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="banner">
          {success}
        </p>
      )}
      {mode !== "reset" && (
        <>
          <Button
            secondary
            disabled={busy}
            onClick={() => void login("paypal-sandbox")}
          >
            <svg
              width="20"
              height="22"
              viewBox="0 0 24 28"
              aria-hidden="true"
              focusable="false"
              style={{ flexShrink: 0 }}
            >
              <path
                fill="#003087"
                d="M7 2h8.1c5 0 7.2 2.5 6.3 6.8-1 5-4.1 7.4-9.1 7.4H9.9l-1.3 8H3.4L7 2Z"
              />
              <path
                fill="#009cde"
                d="M10.1 8h7.1c4.5 0 6.5 2.3 5.7 6.3-.9 4.5-3.7 6.7-8.2 6.7h-2.1l-1 6H6.7l3.4-19Z"
              />
              <path
                fill="#012169"
                d="M10.1 8h7.1c1.7 0 3.1.3 4.1 1-1.1 4.9-4.2 7.2-9 7.2H8.6L10.1 8Z"
              />
            </svg>
            {busy && connecting === "paypal-sandbox"
              ? "Connecting to PayPal..."
              : "Continue with PayPal"}
          </Button>
          <p className="footnote">PayPal sign-in is for test accounts only.</p>
          {busy && connecting === "paypal-sandbox" && (
            <p role="status">Opening PayPal sign-in...</p>
          )}
          <div className="auth-divider">
            <span>or use your email</span>
          </div>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (mode === "reset" ? reset() : login(config.databaseConnection));
        }}
      >
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "reset"
              ? "Send reset link"
              : mode === "signup"
                ? "Create account"
                : "Continue with email"}
          <ArrowRight size={16} />
        </Button>
      </form>
      {mode === "login" && (
        <button
          className="text-link auth-switch"
          disabled={busy}
          onClick={() => switchMode("reset")}
        >
          Forgot password?
        </button>
      )}
      {!resetOnly && (
        <p className="auth-alternate">
          {mode === "login"
            ? "New to Dream Piggy Bank? "
            : "Already have an account? "}
          <button
            className="text-link"
            disabled={busy}
            onClick={() => switchMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      )}
      {!resetOnly && <DemoButton onDemo={onDemo} />}
    </Layout>
  );
}
function AccountProfile({ config }: { config: AuthConfig }) {
  const { user } = useAuth0();
  const [resetting, setResetting] = useState(false);
  return (
    <section className="panel">
      <h2>Your account</h2>
      <p>{user?.name}</p>
      <p>{user?.email || "No email shared by your sign-in provider"}</p>
      <p className="footnote">
        {user?.email_verified
          ? "Email verified"
          : "Email verification pending or unavailable"}
        . Your Dream Piggy Bank display name and preferences can be edited
        below. Your sign-in identity is managed by your identity provider.
      </p>
      {user?.sub?.startsWith("auth0|") && (
        <Button secondary onClick={() => setResetting(!resetting)}>
          {resetting ? "Close password reset" : "Reset password"}
        </Button>
      )}
      {resetting && <AuthScreen config={config} resetOnly />}
    </section>
  );
}
export type SessionState =
  "loading" | "authenticated" | "unauthenticated" | "development-demo";
export function sessionState(
  loading: boolean,
  authenticated: boolean,
  demo = false,
): SessionState {
  return authenticated
    ? loading
      ? "loading"
      : "authenticated"
    : demo && demoEnabled()
      ? "development-demo"
      : loading
        ? "loading"
        : "unauthenticated";
}
export function AuthGate({
  config,
  onDemo,
}: {
  config: AuthConfig;
  onDemo?: () => void;
}) {
  const {
    isLoading,
    isAuthenticated,
    error,
    getAccessTokenSilently,
    getIdTokenClaims,
    logout,
    user,
  } = useAuth0();
  const [ready, setReady] = useState(false);
  const [supabaseError, setSupabaseError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    let active = true;
    if (isAuthenticated) {
      clearDemoSession();
      setReady(false);
      setSupabaseError("");
      // Silent renewal refreshes the SDK's ID token; its opaque access token
      // is deliberately discarded. No custom API audience is requested.
      const idToken = auth0IdTokenProvider(async () => {
        await getAccessTokenSilently();
        return getIdTokenClaims();
      }, !!getBrowserSupabase());
      setAuth0TokenProvider(idToken);
      setSupabaseIdTokenProvider(idToken);
      void (async () => {
        try {
          const client = getBrowserSupabase();
          if (client) {
            // Initialize the profile through the trusted API, then exercise Supabase RLS with Auth0's ID token.
            await api("/onboarding");
            const { data, error: queryError } = await client
              .from("profiles")
              .select("auth0_sub")
              .eq("auth0_sub", user?.sub || "")
              .single();
            if (queryError || data?.auth0_sub !== user?.sub)
              throw queryError || new Error("Profile identity mismatch");
          }
          if (active) setReady(true);
        } catch {
          if (active) {
            setSupabaseError(
              "We couldn't load your account. Please try again or sign in again.",
            );
            setReady(true);
          }
        }
      })();
    } else {
      setReady(false);
      setSupabaseError("");
      setAuth0TokenProvider();
      setSupabaseIdTokenProvider();
    }
    return () => {
      active = false;
      setAuth0TokenProvider();
      setSupabaseIdTokenProvider();
    };
  }, [isAuthenticated, user?.sub, getAccessTokenSilently, getIdTokenClaims]);
  const signOut = () => {
    clearPrivateCache();
    void logout({ logoutParams: { returnTo: location.origin } }).catch(() =>
      setLogoutError("Sign-out failed. Please try again."),
    );
  };
  const status = sessionState(
    isLoading || (isAuthenticated && !ready),
    isAuthenticated,
  );
  if (status === "loading")
    return (
      <AuthLayout>
        <h2 role="status">Getting your wallet ready…</h2>
        <div aria-hidden="true">
          <CardSkeleton kind="profile" />
        </div>
      </AuthLayout>
    );
  if (isAuthenticated && supabaseError)
    return (
      <AuthLayout>
        <h2>Your account is temporarily unavailable.</h2>
        <p role="alert" className="banner error">
          {supabaseError}
        </p>
        <Button onClick={() => location.reload()}>Try again</Button>
        <Button secondary onClick={signOut}>
          Sign out
        </Button>
        {logoutError && <p role="alert">{logoutError}</p>}
      </AuthLayout>
    );
  if (error || !isAuthenticated)
    return (
      <AuthScreen
        config={config}
        onDemo={onDemo}
        initialError={error ? authenticationError(error) : ""}
      />
    );
  return (
    <>
      {logoutError && (
        <p role="alert" className="banner error">
          {logoutError}
        </p>
      )}
      <OnboardingBoundary key={user?.sub} onSignOut={signOut}>
        <App
          accountPanel={<AccountProfile config={config} />}
          onSignOut={signOut}
        />
      </OnboardingBoundary>
    </>
  );
}
function RegularAuthRoot({ onDemo }: { onDemo?: () => void }) {
  const [config, setConfig] = useState<{
    auth0: AuthConfig | null;
    supabase: { url: string; publishableKey: string } | null;
    firebase?: boolean;
  }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    void configuration()
      .then(setConfig)
      .catch(() => setError(true));
  }, []);
  if (error)
    return (
      <AuthLayout>
        <h2>We couldn’t connect.</h2>
        <p role="alert">
          Your information is temporarily unavailable. Please try again.
        </p>
        <Button onClick={() => location.reload()}>Try again</Button>
        <DemoButton onDemo={onDemo} />
      </AuthLayout>
    );
  if (!config)
    return (
      <AuthLayout>
        <h2 role="status">Connecting to your wallet…</h2>
        <div aria-hidden="true">
          <CardSkeleton kind="profile" />
        </div>
      </AuthLayout>
    );
  if (!config.auth0 && config.firebase) return <App />;
  if (!config.auth0)
    return (
      <AuthLayout>
        <h2>Welcome to Dream Piggy Bank.</h2>
        <p>Sign-in is temporarily unavailable. Please try again later.</p>
        <DemoButton onDemo={onDemo} />
      </AuthLayout>
    );
  configureSupabase(config.supabase);
  const c = config.auth0;
  return (
    <Auth0Provider
      domain={c.domain}
      clientId={c.clientId}
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback
      authorizationParams={{
        redirect_uri: location.origin,
        scope: "openid profile email",
      }}
      onRedirectCallback={(state) => {
        history.replaceState({}, "", safeReturnTo(state?.returnTo));
      }}
    >
      <AuthGate config={c} onDemo={onDemo} />
    </Auth0Provider>
  );
}
function DemoButton({ onDemo }: { onDemo?: () => void }) {
  return demoEnabled() && onDemo ? (
    <div className="demo-entry">
      <Button secondary onClick={onDemo}>
        Explore Dream Piggy Bank (Demo Mode)
      </Button>
      <p className="footnote">
        Explore with simulated records saved in this browser tab.
      </p>
    </div>
  ) : null;
}
export function AuthRoot() {
  const [demo, setDemo] = useState(false);
  const [resuming, setResuming] = useState(hasDemoSession);
  const [demoError, setDemoError] = useState("");
  async function enterDemo(restore = false) {
    if (!demoEnabled()) return;
    try {
      // Vite removes this import, and the entire demo data service, in production.
      if (
        import.meta.env.DEV &&
        import.meta.env.VITE_ENABLE_DEMO_MODE === "true"
      ) {
        const { createDemoService } = await import("./demo/service");
        setAuth0TokenProvider();
        setSupabaseIdTokenProvider();
        configureSupabase(null);
        setDemoTransport(createDemoService());
        if (!restore) history.replaceState({}, "", "/#Home");
        setDemo(true);
      }
    } catch {
      clearDemoSession();
      setDemoError(
        "Demo Mode could not start. Allow browser session storage and try again.",
      );
    } finally {
      setResuming(false);
    }
  }
  useEffect(() => {
    if (hasDemoSession()) void enterDemo(true);
    else clearDemoSession();
    return () => setDemoTransport();
  }, []);
  function exitDemo() {
    clearDemoSession();
    setAuth0TokenProvider();
    setSupabaseIdTokenProvider();
    history.replaceState({}, "", "/");
    setDemo(false);
  }
  const status = sessionState(resuming, false, demo);
  if (status === "loading")
    return (
      <AuthLayout>
        <h2 role="status">Restoring local demo...</h2>
      </AuthLayout>
    );
  if (status === "development-demo")
    return (
      <div data-session="development-demo">
        <App
          onSignOut={exitDemo}
          accountPanel={
            <section className="panel">
              <h2>Your profile</h2>
              <p>alex@example.invalid</p>
              <p>
                Edit your display name and preferences below. This profile is
                separate from your signed-in account.
              </p>
              <p className="footnote">
                Goal editing is not implemented in the current application.
                Create and select goals to test round-ups.
              </p>
            </section>
          }
        />
      </div>
    );
  return (
    <>
      {demoError && (
        <p role="alert" className="banner error">
          {demoError}
        </p>
      )}
      <RegularAuthRoot onDemo={() => void enterDemo()} />
    </>
  );
}
