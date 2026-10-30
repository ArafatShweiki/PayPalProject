import { ReportSummary } from "./ReportSummary";
import { useMarketFeed } from "./useMarketFeed";
import { MarketRatesPanel, MarketHistory } from "./MarketRates";
import { PageSkeleton, CardSkeleton } from "./Skeleton";
import { StoragePreferences } from "./InfoNavigation";
import { ErrorState } from "./ErrorState";
import { ApiError, userFacingMessage } from "./errors";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Home,
  Leaf,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
  ChartNoAxesCombined,
} from "lucide-react";
import { api, initAuth, login, logout } from "./api";
import { currencies, money, type Currency } from "../shared/money";
import type { State, Entry, Preferences, Report } from "../shared/types";
import { Button, Empty, Modal, PanelHead, Integration, time } from "./ui";
import {
  Transactions,
  Activity,
  PurchaseForm,
  GoalForm,
  TransactionDetails,
  Conversion,
  Sandbox,
} from "./Wallet";
import { Dashboard } from "./Dashboard";
import { SavingsCarousel } from "./SavingsCarousel";
import { Alerts, CurrencyPerspective } from "./Rates";
import { SettingsForm, AuthForm, ReportArchive } from "./Settings";
const pages = [
  "Home",
  "My Wallet",
  "Smart Savings",
  "Currency Rates",
  "Reports",
  "Settings",
] as const;
type Page = (typeof pages)[number];
export function pageFromHash(hash: string): Page {
  try {
    const decoded = decodeURIComponent(hash.slice(1));
    return (pages as readonly string[]).includes(decoded)
      ? (decoded as Page)
      : "Home";
  } catch {
    return "Home";
  }
}
const icons = [
  Home,
  Wallet,
  Leaf,
  ArrowLeftRight,
  ChartNoAxesCombined,
  Settings,
];
const labels = {
  ILS: "Israeli shekel",
  USD: "US dollar",
  JOD: "Jordanian dinar",
};
const symbols = { ILS: "₪", USD: "$", JOD: "JD" };
export function App({
  accountPanel,
  onSignOut,
}: { accountPanel?: ReactNode; onSignOut?: () => void } = {}) {
  const [state, setState] = useState<State>();
  const [page, setPage] = useState<Page>(() => pageFromHash(location.hash));
  const [error, setError] = useState("");
  const [requestError, setRequestError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<
    "purchase" | "goal" | "notifications" | "auth" | Entry | null
  >(null);
  const [authReady, setAuthReady] = useState(false);
  const [firebase, setFirebase] = useState(false);
  const marketStatus = useMarketFeed(
    state?.authMode,
    (snapshots, staleMs, notices) =>
      setState((current) =>
        current
          ? {
              ...current,
              snapshots,
              rateStaleMs: staleMs,
              ...(notices ? { notices } : {}),
            }
          : current,
      ),
    state?.demoMarketMode,
  );
  const refresh = async () => setState(await api<State>("/state"));
  useEffect(() => {
    void initAuth()
      .then(async (enabled) => {
        setFirebase(enabled);
        setAuthReady(true);
        await refresh();
      })
      .catch((e) => {
        setAuthReady(true);
        setError(userFacingMessage(e.message));
        setRequestError(e);
      });
    const hash = () => {
      setPage(pageFromHash(location.hash));
    };
    const revalidate = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => undefined);
    };
    window.addEventListener("focus", revalidate);
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("focus", revalidate);
    };
  }, []);
  const go = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMobile(false);
  };
  async function run(
    work: () => Promise<unknown>,
    message = "Saved successfully.",
  ) {
    setBusy(true);
    setRequestError(undefined);
    setError("");
    try {
      await work();
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError(
        userFacingMessage(e instanceof Error ? e.message : "Request failed."),
      );
      setRequestError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function generateReport() {
    setReportLoading(true);
    try {
      await run(
        () => api("/reports", { frequency: state!.preferences.frequency }),
        "Report generated.",
      );
    } finally {
      setReportLoading(false);
    }
  }
  const prefs = (update: Partial<Preferences>) =>
    run(() => api("/preferences", update, "PUT"), "Preferences updated.");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const paypalHandled = useRef(false);
  useEffect(() => {
    if (!state || state.authMode === "demo" || paypalHandled.current) return;
    const params = new URLSearchParams(location.search);
    const status = params.get("paypal");
    const token = params.get("token");
    if (status && token) {
      paypalHandled.current = true;
      void run(
        () =>
          api(
            `/paypal/${encodeURIComponent(token)}/${status === "approved" ? "capture" : "cancel"}`,
            {},
          ),
        "PayPal test payment status updated.",
      );
      history.replaceState({}, "", location.pathname + location.hash);
    }
  }, [state]);
  const latest = state?.snapshots.at(-1);
  const [reference, setReference] = useState<Currency>();
  const display = reference || state?.preferences.preferred || "ILS";
  const header = {
    Home: [
      "Your money, in perspective.",
      "A little clarity. A little progress. Every day.",
    ],
    "My Wallet": [
      "One wallet. Three currencies.",
      "Your available balances and every movement, in one place.",
    ],
    "Smart Savings": [
      "Small change. Meaningful progress.",
      "Build a saving habit that fits the way you spend.",
    ],
    "Currency Rates": [
      "A clearer view of your currencies.",
      "Timestamped observations, transparent calculations, and timely alerts.",
    ],
    Reports: ["Reports", "Understand your spending and savings."],
    Settings: [
      "Make Dream Piggy Bank yours.",
      "Your preferences, your rules, your control.",
    ],
  }[page];
  if (!state)
    return (
      <main className="welcome wallet-loading">
        <div className="brand">
          <Wallet />
          Dream Piggy Bank
        </div>
        {error ? (
          <>
            <h1>Your wallet is waiting.</h1>
            {requestError instanceof ApiError ? (
              <ErrorState
                error={requestError}
                onRetry={() => void run(refresh)}
              />
            ) : (
              <p role="alert">{error}</p>
            )}
            {firebase && (
              <AuthForm
                busy={busy}
                submit={async (email, password, register) => {
                  await run(
                    () => login(email, password, register),
                    "Signed in.",
                  );
                }}
              />
            )}
            {!(requestError instanceof ApiError) && (
              <Button onClick={() => void run(refresh)}>Try again</Button>
            )}
            {onSignOut && (
              <Button secondary onClick={onSignOut}>
                Sign out and try again
              </Button>
            )}
          </>
        ) : (
          <>
            <h1>Getting your wallet ready</h1>
            <PageSkeleton area={page} />
          </>
        )}
        {!authReady && <small>Connecting…</small>}
      </main>
    );
  const currencyCards = (
    <div className="currency-grid">
      {currencies.map((c) => (
        <article className="currency-card" key={c}>
          <div className="row">
            <span className={`currency-symbol ${c}`}>{symbols[c]}</span>
            <span>
              <strong>{c}</strong>
              <small>{labels[c]}</small>
            </span>
            <span className="quiet">Available</span>
          </div>
          <h2>{money(state.balances[c], c)}</h2>
          <div className="row muted">
            <Leaf size={14} />
            <span>{money(state.savingsBalances[c], c)} in savings</span>
          </div>
        </article>
      ))}
    </div>
  );
  const reportPanel = (report?: Report) => (
    <ReportSummary state={state} report={report} busy={busy} run={run} />
  );
  return (
    <div className="app-shell">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href="#Home">
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          Dream Piggy Bank<span className="brand-dot">.</span>
        </a>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav>
          {pages.map((p, i) => {
            const Icon = icons[i];
            return (
              <button
                key={p}
                onClick={() => go(p)}
                className={page === p ? "nav-item active" : "nav-item"}
              >
                <Icon size={19} />
                {p}
                {page === p && <span className="active-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <a className="nav-item" href="/help">
            <CircleHelp size={19} />
            Help Center
          </a>
          {state.authMode === "demo" && onSignOut && (
            <Button secondary onClick={onSignOut}>
              <LogOut size={16} />
              Exit Demo Mode
            </Button>
          )}
          <button className="profile" onClick={() => go("Settings")}>
            <span className="avatar">
              {state.preferences.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{state.preferences.name}</strong>
              {state.authMode !== "demo" && <small>Signed in</small>}
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <div className="workspace">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={14} /> <strong>{page}</strong>
            </span>
          </div>
          <div className="row">
            {state.authMode === "demo" && (
              <span className="demo-pill">
                <span />
                Demo Mode
              </span>
            )}
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setModal("notifications")}
            >
              <Bell size={20} />
              {state.notices.some((n) => !n.read) && <i />}
            </button>
            <button
              className="avatar small"
              aria-label="Account settings"
              onClick={() => go("Settings")}
            >
              {state.preferences.name.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              {page !== "Reports" && (
                <span className="eyebrow">
                  {page === "Home"
                    ? `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}, ${state.preferences.name}`
                    : "YOUR " + page.toUpperCase()}
                </span>
              )}
              <h1>{header[0]}</h1>
              <p>{header[1]}</p>
            </div>
            {(page === "Home" || page === "My Wallet") && (
              <Button onClick={() => setModal("purchase")}>
                <Plus size={17} />
                Simulate purchase
              </Button>
            )}
            {page === "Smart Savings" && (
              <Button onClick={() => setModal("goal")}>
                <Plus size={17} />
                New savings goal
              </Button>
            )}
          </div>
          {requestError instanceof ApiError && !modal && (
            <ErrorState
              error={requestError}
              onRetry={() => void run(refresh)}
            />
          )}
          {error && !modal && !(requestError instanceof ApiError) && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {page === "Home" && (
            <Dashboard
              state={state}
              display={display}
              setDisplay={setReference}
              onNavigate={go}
              onCreate={() => setModal("goal")}
              onSelect={setModal}
            />
          )}
          {page === "My Wallet" && (
            <>
              {currencyCards}
              <section className="panel">
                <PanelHead
                  title="Wallet activity"
                  subtitle="Select a row for ledger details."
                />
                <Activity state={state} onSelect={setModal} />
              </section>
              <Sandbox state={state} busy={busy} run={run} />
            </>
          )}
          {page === "Smart Savings" && (
            <>
              {state.preferences.savings === "unseen" && (
                <section className="onboarding">
                  <div className="icon-tile">
                    <Leaf />
                  </div>
                  <div>
                    <span className="eyebrow">
                      A SMALL HABIT WITH A PURPOSE
                    </span>
                    <h2>Meet your automatic savings jar.</h2>
                    <p>
                      A ₪23.40 purchase rounds to ₪25.00, putting ₪1.60 in
                      savings. USD rounds to the next dollar; JOD to the next
                      dinar. Exact multiples save zero.
                    </p>
                    <p>
                      Once activated, future simulated purchases allocate
                      savings automatically. Savings stay separate from
                      spendable funds. You can change the rules any time.
                    </p>
                    <div className="actions">
                      <Button
                        disabled={busy}
                        onClick={() => void prefs({ savings: "enabled" })}
                      >
                        Activate Smart Savings <ArrowRight size={16} />
                      </Button>
                      <Button
                        secondary
                        disabled={busy}
                        onClick={() => void prefs({ savings: "disabled" })}
                      >
                        Not now
                      </Button>
                    </div>
                  </div>
                </section>
              )}
              <div className="currency-grid">
                {currencies.map((c) => (
                  <article className="currency-card" key={c}>
                    <div className="row between">
                      <span className="eyebrow">{c} SAVINGS JAR</span>
                      <Leaf size={18} />
                    </div>
                    <h2>{money(state.savingsBalances[c], c)}</h2>
                    <small>
                      Round to {money(state.preferences.increments[c], c)} · cap{" "}
                      {money(state.preferences.caps[c], c)}
                    </small>
                  </article>
                ))}
              </div>
              <section className="panel">
                <PanelHead
                  title="Your savings goals"
                  subtitle="Each currency has its own selected destination."
                  action={
                    <button
                      className="text-link"
                      onClick={() => go("Settings")}
                    >
                      <SlidersHorizontal size={16} />
                      Manage rules
                    </button>
                  }
                />
                <SavingsCarousel
                  state={state}
                  busy={busy}
                  onCreate={() => setModal("goal")}
                  onDestination={(goal) =>
                    void prefs({
                      goalIds: {
                        ...state.preferences.goalIds,
                        [goal.currency]: goal.id,
                      },
                    })
                  }
                />
              </section>
              <section className="panel">
                <PanelHead
                  title="Your savings advisor"
                  subtitle="Calculations first. Thoughtful explanations second."
                  action={
                    <Button
                      disabled={busy}
                      onClick={() => void generateReport()}
                    >
                      {busy ? "Working…" : "Generate report"}
                    </Button>
                  }
                />
                {reportLoading && !state.reports.length ? (
                  <div role="status" aria-label="Generating report">
                    <CardSkeleton kind="report" />
                  </div>
                ) : (
                  <>
                    {reportLoading && (
                      <p role="status">Updating your report...</p>
                    )}
                    {reportPanel(state.reports[0])}
                  </>
                )}
              </section>
              <section className="panel">
                <PanelHead
                  title="Round-up history"
                  subtitle="Refunds reverse the original savings allocation."
                />
                <Transactions
                  entries={state.ledger
                    .filter((e) => e.saved > 0)
                    .slice()
                    .reverse()}
                  onSelect={setModal}
                />
              </section>
            </>
          )}
          {page === "Currency Rates" && (
            <>
              <MarketRatesPanel
                state={state}
                status={
                  state.authMode === "demo" && state.demoMarketMode === "sample"
                    ? undefined
                    : (marketStatus ?? state.marketStatus)
                }
                busy={busy}
                onModeChange={
                  state.authMode === "demo"
                    ? (mode) =>
                        void run(
                          () => api("/demo/market-mode", { mode }),
                          mode === "live"
                            ? "Real Forex selected. Wallet funds remain simulated."
                            : "Explicit sample-rate mode selected.",
                        )
                    : undefined
                }
                onRefresh={() =>
                  void run(
                    () => api("/rates/refresh", {}),
                    state.authMode === "demo" &&
                      state.demoMarketMode === "sample"
                      ? "Simulated rates updated locally."
                      : "Rates checked.",
                  )
                }
              />
              <MarketHistory state={state} />
              <Conversion
                key={state.demoMarketMode}
                state={state}
                busy={busy}
                run={run}
              />
              <Alerts state={state} busy={busy} run={run} />
              <CurrencyPerspective state={state} busy={busy} run={run} />
            </>
          )}
          {page === "Reports" && (
            <>
              <section className="panel">
                <PanelHead
                  title="Your financial review"
                  subtitle={
                    state.preferences.frequency === "weekly"
                      ? "Last 7 days"
                      : "Last 30 days"
                  }
                  action={
                    <div className="actions report-controls">
                      <select
                        aria-label="Report frequency"
                        value={state.preferences.frequency}
                        onChange={(e) =>
                          void prefs({
                            frequency: e.target.value as "weekly" | "monthly",
                          })
                        }
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                      <Button
                        disabled={busy}
                        onClick={() => void generateReport()}
                      >
                        {busy ? "Generating…" : "Generate report"}
                      </Button>
                    </div>
                  }
                />
                {reportLoading && !state.reports.length ? (
                  <div role="status" aria-label="Generating report">
                    <CardSkeleton kind="report" />
                  </div>
                ) : (
                  <>
                    {reportLoading && (
                      <p role="status">Updating your report...</p>
                    )}
                    {reportPanel(state.reports[0])}
                  </>
                )}
              </section>
              <section className="panel">
                <PanelHead
                  title="Report archive"
                  subtitle="Saved summaries from your wallet history."
                />
                {state.reports.length ? (
                  <ReportArchive reports={state.reports} />
                ) : (
                  <Empty>Your generated reports will appear here.</Empty>
                )}
              </section>
            </>
          )}
          {page === "Settings" && (
            <>
              {accountPanel}
              <StoragePreferences />
              <SettingsForm state={state} busy={busy} save={prefs} />
              <section className="panel">
                <PanelHead
                  title="Account & features"
                  subtitle={
                    state.authMode === "demo"
                      ? "Demo records stay in this browser tab."
                      : "Manage your account and available features."
                  }
                />
                <div className="integration-grid">
                  <Integration
                    name="Currency rate data"
                    text={
                      state.authMode === "demo" &&
                      state.demoMarketMode === "sample"
                        ? "Simulated sample rates - no live request"
                        : latest
                          ? "Market observations available"
                          : "Not retrieved yet"
                    }
                  />
                  <Integration
                    name="AI explanations"
                    text={
                      state.capabilities.gemini
                        ? "Available for reports and currency insights"
                        : "Calculated reports and insights available"
                    }
                  />
                  <Integration
                    name="PayPal test payments"
                    text={
                      state.capabilities.paypal
                        ? "Available with a PayPal test account"
                        : "Currently unavailable"
                    }
                  />
                </div>
                <div className="actions">
                  {firebase && (
                    <Button secondary onClick={() => setModal("auth")}>
                      Sign in / create account
                    </Button>
                  )}
                  <Button
                    secondary
                    onClick={() =>
                      onSignOut
                        ? onSignOut()
                        : void run(async () => {
                            await logout();
                            setState(undefined);
                          }, "Signed out. A fresh demo session is ready.")
                    }
                  >
                    <LogOut size={16} />
                    {state.authMode === "demo" ? "Exit Demo Mode" : "Sign out"}
                  </Button>
                </div>
                <p className="footnote">
                  {state.authMode === "demo"
                    ? "Exiting clears this tab demo data and returns to sign-in. Demo records never migrate into signed-in accounts."
                    : "Account records stay separate from development demo data."}
                </p>
              </section>
            </>
          )}
          <footer>
            <span>
              <ShieldCheck size={14} />
              Dream Piggy Bank · PayPal AI Hackathon prototype
            </span>
          </footer>
        </main>
      </div>
      {modal === "purchase" && (
        <Modal
          title="Simulate a purchase"
          onClose={() => setModal(null)}
          error={error}
        >
          <PurchaseForm
            state={state}
            busy={busy}
            submit={async (body) => {
              if (
                await run(
                  () => api("/purchases", body),
                  "Purchase completed. Savings allocated according to your rules.",
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === "goal" && (
        <Modal
          title="Give your savings a purpose"
          onClose={() => setModal(null)}
          error={error}
        >
          <GoalForm
            busy={busy}
            submit={async (body) => {
              if (
                await run(
                  () => api("/goals", body),
                  "Goal created and selected for future round-ups.",
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === "notifications" && (
        <Modal
          title="Your notifications"
          onClose={() => setModal(null)}
          error={error}
        >
          {state.notices.length ? (
            <>
              <Button
                secondary
                onClick={() =>
                  void run(
                    () => api("/notifications/read", {}),
                    "Notifications marked as read.",
                  )
                }
              >
                Mark all read
              </Button>
              {state.notices.map((n) => (
                <div className="notice" key={n.id}>
                  <strong>
                    {!n.read && "● "}
                    {n.title}
                  </strong>
                  <p>{n.body}</p>
                  <small>{time(n.at)}</small>
                </div>
              ))}
            </>
          ) : (
            <Empty>
              No alerts yet. Configure a currency alert to keep an eye on a
              rate.
            </Empty>
          )}
        </Modal>
      )}
      {modal === "auth" && (
        <Modal
          title="Welcome to your wallet"
          onClose={() => setModal(null)}
          error={error}
        >
          <AuthForm
            busy={busy}
            submit={async (email, password, register) => {
              if (
                await run(() => login(email, password, register), "Signed in.")
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {typeof modal === "object" && modal !== null && (
        <Modal
          title="Activity details"
          onClose={() => setModal(null)}
          error={error}
        >
          <TransactionDetails entry={modal} />
          {modal.kind === "purchase" &&
            !state.ledger.some((e) => e.originalId === modal.id) && (
              <Button
                secondary
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api("/refunds", {
                        id: modal.id,
                        requestId: crypto.randomUUID(),
                      }),
                    "Purchase and its savings allocation fully reversed.",
                  ).then((ok) => {
                    if (ok) setModal(null);
                  })
                }
              >
                Refund simulated purchase
              </Button>
            )}
        </Modal>
      )}
    </div>
  );
}
