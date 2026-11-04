import { Invitation } from "./Circles";
import { CardSkeleton, PageSkeleton } from "./Skeleton";
import { startStage, finishStage } from "./performance";
import { clearPrivateCache } from "./requestCache";
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
const loadWalletApp = () => import("./App");
const WalletApp = lazy(() =>
  loadWalletApp().then((module) => ({ default: module.App })),
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
import { configuration, setAuth0TokenProvider } from "./api";
import { Button } from "./ui";
import {
  sdkIdTokenProvider,
  configureSupabase,
  supabaseConfigured,
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
  return /^(?:\/#(?:Home|My%20Wallet|Smart%20Savings|Currency%20Rates|Reports|Settings|Savings%20Circles)|\/circles\/invite\/[A-Za-z0-9_-]{43})$/.test(
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
  invitation,
}: {
  config: AuthConfig;
  initialError?: string;
  resetOnly?: boolean;
  invitation?: ReactNode;
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
      {invitation}
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
export type SessionState = "loading" | "authenticated" | "unauthenticated";
export function sessionState(
  loading: boolean,
  authenticated: boolean,
): SessionState {
  return authenticated
    ? loading
      ? "loading"
      : "authenticated"
    : loading
      ? "loading"
      : "unauthenticated";
}
export function AuthGate({ config }: { config: AuthConfig }) {
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
  const [providerSubject, setProviderSubject] = useState<string>();
  const [restoreSlow, setRestoreSlow] = useState(false);
  useEffect(() => {
    setRestoreSlow(false);
    if (!isLoading) return;
    const timer = setTimeout(() => setRestoreSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [isLoading]);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    if (isLoading) startStage("auth_restore");
    else finishStage("auth_restore");
  }, [isLoading]);
  useEffect(() => {
    if (isAuthenticated) {
      setReady(false);
      // Silent renewal refreshes the SDK's ID token; its opaque access token
      // is deliberately discarded. No custom API audience is requested.
      const idToken = sdkIdTokenProvider(
        getIdTokenClaims,
        () => getAccessTokenSilently(),
        supabaseConfigured(),
        user?.sub,
      );
      setAuth0TokenProvider(idToken);
      setSupabaseIdTokenProvider(idToken);
      setProviderSubject(user?.sub || "authenticated");
      void loadWalletApp().catch(() => undefined);
      setReady(true);
    } else {
      setReady(false);
      setProviderSubject(undefined);
      setAuth0TokenProvider();
      setSupabaseIdTokenProvider();
    }
    return () => {
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
    isLoading ||
      (isAuthenticated &&
        (!ready || providerSubject !== (user?.sub || "authenticated"))),
    isAuthenticated,
  );
  if (restoreSlow && isLoading)
    return (
      <AuthLayout>
        <h2>Sign-in is taking longer than expected.</h2>
        <p role="alert">
          Please try again. Your wallet information has not been loaded.
        </p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </AuthLayout>
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
  if (error || !isAuthenticated)
    return (
      <AuthScreen
        config={config}
        initialError={error ? authenticationError(error) : ""}
        invitation={
          /^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(location.pathname) ? (
            <Invitation />
          ) : undefined
        }
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
        {(initial) => (
          <App
            initial={initial}
            accountPanel={<AccountProfile config={config} />}
            onSignOut={signOut}
          />
        )}
      </OnboardingBoundary>
    </>
  );
}
function RegularAuthRoot() {
  const [config, setConfig] = useState<{
    auth0: AuthConfig | null;
    supabase: { url: string; publishableKey: string } | null;
  }>();
  const [error, setError] = useState(false);
  useEffect(() => {
    startStage("dashboard_usable");
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

  if (!config.auth0)
    return (
      <AuthLayout>
        <h2>Welcome to Dream Piggy Bank.</h2>
        <p>Sign-in is temporarily unavailable. Please try again later.</p>
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
      httpTimeoutInSeconds={10}
      authorizationParams={{
        redirect_uri: location.origin,
        scope: "openid profile email",
      }}
      onRedirectCallback={(state) => {
        history.replaceState({}, "", safeReturnTo(state?.returnTo));
      }}
    >
      <AuthGate config={c} />
    </Auth0Provider>
  );
}
export function AuthRoot() {
  return <RegularAuthRoot />;
}
