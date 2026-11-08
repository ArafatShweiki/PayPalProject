import { goalAmount } from "./savings";
import { SavingsCoach } from "./SavingsCoach";
import { ProductGuide } from "./ProductGuide";
import { Circles, Invitation } from "./Circles";
import { SavingsSetup, SavingsDestinationPanel } from "./SavingsSetup";
import { GoalPurchase } from "./GoalPurchase";
import type { SavingsDestination, SavingsOptions } from "../shared/circles";
import { useWalletData } from "./useWalletData";
import { DeferredSection } from "./DeferredSection";
import { Funding } from "./Funding";
import { ReportSummary } from "./ReportSummary";
import { useMarketFeed } from "./useMarketFeed";
import { MarketRatesPanel, MarketHistory } from "./MarketRates";
import { PageSkeleton, CardSkeleton } from "./Skeleton";
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
  Users,
  ChartNoAxesCombined,
} from "lucide-react";
import { api, logout } from "./api";
import { currencies, money, type Currency } from "../shared/money";
import type { State, Entry, Preferences, Report, Goal } from "../shared/types";
import { Button, Empty, Modal, PanelHead, time } from "./ui";
import {
  Transactions,
  Activity,
  GoalForm,
  TransactionDetails,
  Conversion,
} from "./Wallet";
import { Dashboard } from "./Dashboard";
import { SavingsCarousel } from "./SavingsCarousel";
import { Alerts, CurrencyPerspective } from "./Rates";
import { SettingsForm, ReportArchive } from "./Settings";
const pages = [
  "Home",
  "My Wallet",
  "Smart Savings",
  "Savings Circles",
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
  Users,
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
  initial,
}: {
  initial?: State;
  accountPanel?: ReactNode;
  onSignOut?: () => void;
} = {}) {
  const [page, setPage] = useState<Page>(() => pageFromHash(location.hash));
  const {
    state,
    setState,
    refresh,
    essentialError,
    sections,
    retrySection,
    loadMore,
    hasMore,
    moreLoading,
    setActivityFilter,
  } = useWalletData(initial, page);
  const [error, setError] = useState("");
  const [requestError, setRequestError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [inspectedGoalId, setInspectedGoalId] = useState<string>();
  const [deletingGoal, setDeletingGoal] = useState<Goal>();
  const [busy, setBusy] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDate, setReportDate] = useState("");
  const reportRequest = useRef(false);
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<
    | "purchase"
    | "goal"
    | "notifications"
    | "funding"
    | "savings-setup"
    | Entry
    | null
  >(null);
  const [pendingPreferences, setPendingPreferences] =
    useState<Partial<Preferences>>();
  const setupOffered = useRef(false);
  const destinationRequest = useRef(false);
  const destinationSaved = (destination: SavingsDestination) => {
    if (destination.kind === "goal") setInspectedGoalId(destination.id);
    setState((current) =>
      current
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              savings: "enabled",
              savingsDestination: destination,
            },
          }
        : current,
    );
  };
  async function saveDestination(
    destination: Pick<SavingsDestination, "kind" | "id">,
  ) {
    if (destinationRequest.current) return;
    destinationRequest.current = true;
    try {
      await run(async () => {
        const saved = await api<SavingsDestination>(
          "/savings/destination",
          { ...destination, enable: true },
          "PUT",
        );
        destinationSaved(saved);
      }, "Smart Savings destination updated.");
    } finally {
      destinationRequest.current = false;
    }
  }
  const [invitationOpen, setInvitationOpen] = useState(
    /^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(location.pathname),
  );
  const [authReady, setAuthReady] = useState(false);
  const [marketVersion, setMarketVersion] = useState(0);
  useEffect(() => {
    if (
      !setupOffered.current &&
      state?.preferences.savings === "enabled" &&
      !state.preferences.savingsDestination &&
      !invitationOpen &&
      modal === null &&
      ["Home", "Smart Savings", "My Wallet"].includes(page)
    ) {
      setupOffered.current = true;
      setPendingPreferences({ savings: "enabled" });
      setModal("savings-setup");
    }
  }, [
    state?.preferences.savings,
    state?.preferences.savingsDestination,
    invitationOpen,
    page,
    modal,
  ]);
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
    marketVersion,
  );
  useEffect(() => {
    setAuthReady(true);
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
  useEffect(() => {
    if (essentialError) {
      setError(
        userFacingMessage(
          essentialError instanceof Error
            ? essentialError.message
            : "Unable to load your wallet.",
        ),
      );
      setRequestError(essentialError);
    }
  }, [essentialError]);
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
  const [reportsMoreLoading, setReportsMoreLoading] = useState(false);
  const [reportsMoreError, setReportsMoreError] = useState(false);
  const reportsRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => reportsRequest.current?.abort(), []);
  async function loadMoreReports() {
    if (!state || reportsMoreLoading) return;
    const controller = new AbortController();
    reportsRequest.current = controller;
    setReportsMoreLoading(true);
    setReportsMoreError(false);
    try {
      const page = await api<{ reports: Report[]; total: number }>(
        `/account/reports?offset=${state.reports.length}`,
        undefined,
        "GET",
        { signal: controller.signal },
      );
      setState((current) =>
        current
          ? {
              ...current,
              reports: [
                ...new Map(
                  [...current.reports, ...page.reports].map((r) => [r.id, r]),
                ).values(),
              ],
              reportTotal: page.total,
            }
          : current,
      );
    } catch {
      if (!controller.signal.aborted) setReportsMoreError(true);
    } finally {
      if (!controller.signal.aborted) setReportsMoreLoading(false);
    }
  }
  async function generateReport() {
    if (reportRequest.current) return;
    reportRequest.current = true;
    setReportLoading(true);
    try {
      await run(
        () =>
          api("/reports", {
            frequency: state!.preferences.frequency,
            ...(reportDate ? { date: reportDate } : {}),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          }),
        "Report saved.",
      );
    } finally {
      setReportLoading(false);
      reportRequest.current = false;
    }
  }
  const prefs = async (update: Partial<Preferences>) => {
    if (update.savings === "enabled") {
      try {
        const choices = await api<SavingsOptions>(
          "/savings/options",
          undefined,
          "GET",
        );
        if (
          state?.preferences.savings !== "enabled" ||
          !choices.options.some(
            (o) =>
              o.kind === choices.destination?.kind &&
              o.id === choices.destination?.id,
          )
        ) {
          setPendingPreferences(update);
          setModal("savings-setup");
          return false;
        }
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    }
    return run(
      () => api("/preferences", update, "PUT"),
      "Preferences updated.",
    );
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const paypalHandled = useRef(false);
  useEffect(() => {
    if (!state || paypalHandled.current) return;
    const params = new URLSearchParams(location.search);
    const status = params.get("funding"),
      id = params.get("fundingId");
    if (status && id) {
      paypalHandled.current = true;
      if (/^[0-9a-f-]{36}$/i.test(id)) {
        let resultStatus = "";
        void run(async () => {
          const order = await api<{ status: string }>(
            `/funding/${id}/${status === "approved" ? "capture" : "cancel"}`,
            {},
          );
          resultStatus = order.status;
          setModal("funding");
        }, "Payment checked.").then((ok) => {
          if (ok)
            setNotice(
              resultStatus === "COMPLETED"
                ? "Funds added to your test wallet."
                : `Payment status: ${resultStatus}. Check funding activity for updates.`,
            );
        });
      }
      history.replaceState({}, "", location.pathname + location.hash);
    }
  }, [state]);
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
    "Savings Circles": [
      "Savings Circles",
      "Shared goals. Clear contributions. Unanimous decisions.",
    ],
    Reports: ["Reports", "Understand your spending and savings."],
    Settings: [
      "Make Dream Piggy Bank yours.",
      "Your preferences, your rules, your control.",
    ],
  }[page];
  const showRequestErrorPage =
    requestError instanceof ApiError &&
    ![400, 409, 422].includes(requestError.status);
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
                onRetry={() => void run(() => refresh())}
              />
            ) : (
              <p role="alert">{error}</p>
            )}
            {!(requestError instanceof ApiError) && (
              <Button onClick={() => void run(() => refresh())}>
                Try again
              </Button>
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
        <nav className="sidebar-navigation" aria-label="Workspace">
          <div className="workspace-links">
            {pages
              .filter((p) => p !== "Settings")
              .map((p) => {
                const i = pages.indexOf(p);
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
          </div>
          <div className="sidebar-bottom">
            <button
              onClick={() => go("Settings")}
              className={page === "Settings" ? "nav-item active" : "nav-item"}
              aria-current={page === "Settings" ? "page" : undefined}
            >
              <Settings size={19} />
              Settings
              {page === "Settings" && <span className="active-dot" />}
            </button>
            <a className="nav-item" href="/help">
              <CircleHelp size={19} />
              Help Center
            </a>

            <button className="profile" onClick={() => go("Settings")}>
              <span className="avatar">
                {state.preferences.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{state.preferences.name}</strong>
                {<small>Signed in</small>}
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </nav>
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
          {showRequestErrorPage && !modal && (
            <ErrorState
              error={requestError}
              onRetry={() => void run(() => refresh())}
            />
          )}
          {error && !modal && !showRequestErrorPage && (
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
          {invitationOpen && (
            <Invitation
              onDismiss={() => {
                setInvitationOpen(false);
                go("Home");
              }}
              authenticated
              onJoined={() => {
                setInvitationOpen(false);
                go("Savings Circles");
              }}
            />
          )}
          <ProductGuide
            state={state}
            page={page}
            onNavigate={go}
            onFund={() => setModal("funding")}
            onGoal={() => setModal("goal")}
            onPurchase={() => setModal("purchase")}
            onSavings={() => {
              setPendingPreferences(undefined);
              setModal("savings-setup");
            }}
          />
          {page === "Savings Circles" && (
            <Circles
              state={state}
              onUpdated={refresh}
              onDestinationSaved={destinationSaved}
            />
          )}
          {page === "Home" && (
            <Dashboard
              state={state}
              display={display}
              setDisplay={setReference}
              onNavigate={go}
              onCreate={() => setModal("goal")}
              onSelect={setModal}
              onAddFunds={() => setModal("funding")}
              sections={sections}
              onRetrySection={retrySection}
              marketLoading={!marketStatus}
              marketError={
                marketStatus?.connection === "unavailable"
                  ? marketStatus.error
                  : undefined
              }
              onRetryMarket={() => setMarketVersion((v) => v + 1)}
            />
          )}
          {page === "My Wallet" && (
            <>
              <div className="wallet-funding">
                {currencyCards}
                <div className="actions">
                  <Button onClick={() => setModal("funding")}>Add Funds</Button>
                </div>
              </div>
              <section className="panel wallet-activity">
                <PanelHead
                  title="Wallet activity"
                  subtitle="Select a row for ledger details."
                />
                <Activity
                  state={state}
                  onSelect={setModal}
                  onFilter={setActivityFilter}
                  loading={sections.activity.loading}
                  error={sections.activity.error}
                  retry={() => retrySection("activity")}
                />
                {hasMore && !sections.activity.loading && (
                  <Button
                    secondary
                    disabled={moreLoading}
                    onClick={() => void loadMore()}
                  >
                    {moreLoading ? "Loading..." : "Load more activity"}
                  </Button>
                )}
              </section>
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
              <SavingsCoach
                state={state}
                onExplore={() => go("Smart Savings")}
                onReports={() => go("Reports")}
                onRules={() => go("Settings")}
              />
              <SavingsDestinationPanel
                state={state}
                onChoose={() => {
                  setPendingPreferences(undefined);
                  setModal("savings-setup");
                }}
              />
              <section className="panel">
                <PanelHead
                  title="Your savings goals"
                  subtitle="Set a default goal for future round-ups."
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
                <DeferredSection
                  label="savings goals"
                  {...sections.overview}
                  retry={() => retrySection("overview")}
                >
                  <SavingsCarousel
                    state={state}
                    busy={busy}
                    selectedGoalId={inspectedGoalId}
                    onInspect={setInspectedGoalId}
                    onCreate={() => setModal("goal")}
                    onDestination={(goal) =>
                      void saveDestination({ kind: "goal", id: goal.id })
                    }
                    onClearDefault={() => void prefs({ savings: "disabled" })}
                    onDelete={(goal) => {
                      setError("");
                      setDeletingGoal(goal);
                    }}
                  />
                </DeferredSection>
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
                    <DeferredSection
                      label="reports"
                      {...sections.overview}
                      retry={() => retrySection("overview")}
                    >
                      {reportPanel(state.reports[0])}
                    </DeferredSection>
                  </>
                )}
              </section>
              <section className="panel">
                <PanelHead
                  title="Round-up history"
                  subtitle="Personal-goal refunds reverse savings. Circle savings require an approved return."
                />
                <DeferredSection
                  label="round-up history"
                  {...sections.activity}
                  retry={() => retrySection("activity")}
                >
                  <Transactions
                    entries={state.ledger
                      .filter((e) => e.saved > 0)
                      .slice()
                      .reverse()}
                    onSelect={setModal}
                  />
                  {hasMore && (
                    <Button
                      secondary
                      disabled={moreLoading}
                      onClick={() => void loadMore()}
                    >
                      {moreLoading ? "Loading..." : "Load more activity"}
                    </Button>
                  )}
                </DeferredSection>
              </section>
            </>
          )}
          {page === "Currency Rates" && (
            <>
              <MarketRatesPanel
                state={state}
                status={marketStatus ?? state.marketStatus}
                busy={busy}
                onRefresh={() =>
                  void run(() => api("/rates/refresh", {}), "Rates checked.")
                }
              />
              <MarketHistory state={state} />
              <Conversion
                state={state}
                busy={busy}
                run={run}
                onAddFunds={() => setModal("funding")}
              />
              <DeferredSection
                label="currency alerts"
                {...sections.overview}
                retry={() => retrySection("overview")}
              >
                <Alerts state={state} busy={busy} run={run} />
              </DeferredSection>
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
                      ? "Seven days ending on the selected date"
                      : "Selected calendar month"
                  }
                  action={
                    <div className="actions report-controls">
                      <select
                        aria-label="Report frequency"
                        disabled={busy}
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
                      <input
                        type="date"
                        aria-label="Reporting date"
                        title="Leave empty to use today in your timezone"
                        value={reportDate}
                        disabled={busy}
                        onChange={(e) => setReportDate(e.target.value)}
                      />
                      <Button
                        disabled={busy}
                        onClick={() => void generateReport()}
                      >
                        {busy ? "Generating…" : "Generate report"}
                      </Button>
                    </div>
                  }
                />
                {reportLoading ? (
                  <div role="status" aria-label="Generating report">
                    <div className="report-totals">
                      <CardSkeleton kind="report" />
                      <CardSkeleton kind="report" />
                      <CardSkeleton kind="report" />
                    </div>
                    <CardSkeleton kind="report" />
                  </div>
                ) : (
                  <>
                    {reportLoading && (
                      <p role="status">Updating your report...</p>
                    )}
                    <DeferredSection
                      label="reports"
                      {...sections.overview}
                      retry={() => retrySection("overview")}
                    >
                      {reportPanel(state.reports[0])}
                    </DeferredSection>
                  </>
                )}
              </section>
              <section className="panel">
                <PanelHead
                  title="Report archive"
                  subtitle="Saved summaries from your wallet history."
                />
                <DeferredSection
                  label="report archive"
                  {...sections.overview}
                  retry={() => retrySection("overview")}
                >
                  {state.reports.length ? (
                    <>
                      <ReportArchive reports={state.reports} />
                      {(state.reportTotal ?? 0) > state.reports.length && (
                        <Button
                          secondary
                          disabled={reportsMoreLoading}
                          onClick={() => void loadMoreReports()}
                        >
                          {reportsMoreLoading
                            ? "Loading..."
                            : "Load more reports"}
                        </Button>
                      )}
                      {reportsMoreError && (
                        <p role="alert">
                          We couldn't load older reports. Please try again.
                        </p>
                      )}
                    </>
                  ) : (
                    <Empty>Your generated reports will appear here.</Empty>
                  )}
                </DeferredSection>
              </section>
            </>
          )}
          {page === "Settings" && (
            <>
              {accountPanel}
              <DeferredSection
                label="account preferences"
                {...sections.overview}
                retry={() => retrySection("overview")}
              >
                <SettingsForm state={state} busy={busy} save={prefs} />
              </DeferredSection>
              <div className="actions">
                <Button
                  secondary
                  onClick={() =>
                    onSignOut
                      ? onSignOut()
                      : void run(async () => {
                          await logout();
                          setState(undefined);
                        }, "Signed out.")
                  }
                >
                  <LogOut size={16} />
                  {"Sign out"}
                </Button>
              </div>
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
      {modal === "funding" && (
        <Modal title="Add Funds" onClose={() => setModal(null)} error="">
          <Funding onClose={() => setModal(null)} onUpdated={refresh} />
        </Modal>
      )}
      {modal === "savings-setup" && (
        <Modal
          title="Set up Smart Savings"
          onClose={() => {
            setModal(null);
            setPendingPreferences(undefined);
          }}
          error={error}
        >
          <SavingsSetup
            onDone={async (saved) => {
              destinationSaved(saved);
              const ok = await run(async () => {
                if (pendingPreferences)
                  await api("/preferences", pendingPreferences, "PUT");
              }, "Smart Savings destination updated.");
              if (ok) {
                setModal(null);
                setPendingPreferences(undefined);
              }
            }}
          />
        </Modal>
      )}
      {modal === "purchase" && (
        <Modal
          title="Simulate a purchase"
          onClose={() => {
            setModal(null);
            setError("");
            setRequestError(undefined);
          }}
          error={error}
        >
          <GoalPurchase
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
      {deletingGoal && (
        <Modal
          title="Delete savings goal?"
          onClose={() => {
            if (!busy) setDeletingGoal(undefined);
          }}
          error={error}
        >
          <p>
            Delete {deletingGoal.name}? Its current savings of{" "}
            {money(goalAmount(state, deletingGoal.id), deletingGoal.currency)}{" "}
            will return to your main {deletingGoal.currency} wallet, without
            currency conversion.
          </p>
          <p>
            The goal will be removed. Transaction history stays available. If
            this is your default goal, Smart Savings will pause until you choose
            another destination.
          </p>
          <div className="actions">
            <Button
              secondary
              disabled={busy}
              onClick={() => setDeletingGoal(undefined)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                if (
                  await run(
                    () => api(`/goals/${deletingGoal.id}`, {}, "DELETE"),
                    "Goal deleted. Its savings were returned to your main wallet in the same currency.",
                  )
                )
                  setDeletingGoal(undefined);
              }}
            >
              {busy ? "Deleting..." : "Delete goal and return funds"}
            </Button>
          </div>
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
              if (await run(() => api("/goals", body), "Savings goal created."))
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
          <DeferredSection
            label="notifications"
            {...sections.overview}
            retry={() => retrySection("overview")}
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
          </DeferredSection>
        </Modal>
      )}

      {typeof modal === "object" && modal !== null && (
        <Modal
          title="Activity details"
          onClose={() => setModal(null)}
          error={error}
        >
          <TransactionDetails entry={modal} goals={state.goals} />
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
                    modal.circleId
                      ? "Purchase refunded. The Circle contribution remains locked."
                      : "Purchase and its savings allocation fully reversed.",
                  ).then((ok) => {
                    if (ok) setModal(null);
                  })
                }
              >
                {modal.circleId
                  ? "Refund purchase only"
                  : "Refund simulated purchase"}
              </Button>
            )}
        </Modal>
      )}
    </div>
  );
}
