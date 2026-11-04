import { startStage, finishStage } from "./performance";
import { CardSkeleton } from "./Skeleton";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import type { OnboardingStatus, Bootstrap, State } from "../shared/types";
import { api } from "./api";
import { ApiError } from "./errors";
import { Button } from "./ui";

export function OnboardingForm({
  initial,
  complete,
}: {
  initial: OnboardingStatus;
  complete: (status: OnboardingStatus) => void;
}) {
  const [name, setName] = useState(initial.fullName);
  const [email, setEmail] = useState(initial.email);
  const [preferred, setPreferred] = useState(initial.preferred);
  const [savings, setSavings] = useState(
    initial.savings === "unseen" ? "" : initial.savings,
  );
  const [notifications, setNotifications] = useState(initial.notifications);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<OnboardingStatus>(
        "/onboarding",
        {
          fullName: name.trim(),
          email: email.trim(),
          preferred,
          savings,
          notifications,
        },
        "PUT",
      );
      if (!saved.complete)
        throw new Error("Your profile wasn’t saved. Please try again.");
      complete(saved);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t save your profile. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="onboarding-form"
    >
      <span className="eyebrow">LET’S MAKE THIS YOURS</span>
      <h1>A wallet that fits you.</h1>
      <p>
        A few details to get started. Your preferences can be updated in
        Settings.
      </p>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <label>
          Full name
          <input
            name="fullName"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            pattern=".*\S.*"
          />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
            aria-describedby="email-status"
          />
        </label>
        <p id="email-status" className="footnote">
          {initial.emailVerified && email.trim() === initial.email
            ? "Verified by your sign-in provider."
            : "Not verified. This is your contact email; changing it does not change your sign-in account."}
        </p>
        <label>
          Preferred currency
          <select
            value={preferred}
            onChange={(e) => setPreferred(e.target.value as typeof preferred)}
          >
            <option value="ILS">ILS · Israeli shekel</option>
            <option value="USD">USD · US dollar</option>
            <option value="JOD">JOD · Jordanian dinar</option>
          </select>
        </label>
        <fieldset className="savings-choice">
          <legend>Smart Savings</legend>
          <p>
            Round up simulated purchases and put the difference toward your
            goals. Choose once to finish setup.
          </p>
          <label className="check">
            <input
              type="radio"
              name="savings"
              value="enabled"
              required
              checked={savings === "enabled"}
              onChange={() => setSavings("enabled")}
            />
            Activate Smart Savings
          </label>
          <label className="check">
            <input
              type="radio"
              name="savings"
              value="disabled"
              required
              checked={savings === "disabled"}
              onChange={() => setSavings("disabled")}
            />
            Not now
          </label>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
          Enable in-app currency notifications (optional)
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving your profile…" : "Open my wallet"}
          <ArrowRight size={16} />
        </Button>
      </fieldset>
      <p className="footnote">
        <ShieldCheck size={14} /> Your wallet is simulated. We never ask for
        payment credentials.
      </p>
    </form>
  );
}

export function OnboardingBoundary({
  children,
  onSignOut,
}: {
  children: ReactNode | ((state: State) => ReactNode);
  onSignOut: () => void;
}) {
  const [profile, setProfile] = useState<OnboardingStatus>();
  const [initial, setInitial] = useState<State>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError("");
    setProfile(undefined);
    startStage("profile_bootstrap");
    startStage("wallet_essential");
    void api<Bootstrap>("/bootstrap", undefined, "GET", {
      signal: controller.signal,
    })
      .then((loaded) => {
        if (!active) return;
        const result = loaded.onboarding;
        if (result.complete && !loaded.state)
          throw new Error("Wallet information missing");
        setInitial(loaded.state);
        finishStage("profile_bootstrap");
        finishStage("wallet_essential");
        if (!result.complete) {
          if (/^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(location.pathname))
            sessionStorage.setItem(
              "walletwise:circle-invite",
              location.pathname,
            );
          history.replaceState({}, "", "/onboarding");
        } else if (location.pathname === "/onboarding")
          history.replaceState(
            {},
            "",
            /^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(
              sessionStorage.getItem("walletwise:circle-invite") || "",
            )
              ? sessionStorage.getItem("walletwise:circle-invite")!
              : "/#Home",
          );
        setProfile(result);
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof ApiError
              ? error.message
              : "We couldn’t load your profile. Please try again.",
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);
  useEffect(() => {
    const recheck = () => {
      setProfile(undefined);
      setAttempt((value) => value + 1);
    };
    const enforceRoute = () => {
      if (profile && !profile.complete)
        history.replaceState({}, "", "/onboarding");
      else if (profile?.complete && location.pathname === "/onboarding")
        history.replaceState(
          {},
          "",
          /^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(
            sessionStorage.getItem("walletwise:circle-invite") || "",
          )
            ? sessionStorage.getItem("walletwise:circle-invite")!
            : "/#Home",
        );
    };
    window.addEventListener("walletwise:onboarding-required", recheck);
    window.addEventListener("popstate", enforceRoute);
    window.addEventListener("hashchange", enforceRoute);
    return () => {
      window.removeEventListener("walletwise:onboarding-required", recheck);
      window.removeEventListener("popstate", enforceRoute);
      window.removeEventListener("hashchange", enforceRoute);
    };
  }, [profile]);
  if (profile?.complete)
    return (
      <>
        {saved && (
          <p role="status" className="banner onboarding-success">
            Your profile is ready. Welcome to Dream Piggy Bank.
          </p>
        )}
        {typeof children === "function" ? children(initial!) : children}
      </>
    );
  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <a className="brand" href="/">
          <Wallet />
          Dream Piggy Bank<span className="brand-dot">.</span>
        </a>
        <Button secondary onClick={onSignOut}>
          Sign out
        </Button>
      </header>
      <section className="panel onboarding-panel">
        {error ? (
          <>
            <h1>Your wallet is waiting.</h1>
            <p role="alert" className="banner error">
              {error}
            </p>
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </>
        ) : !profile ? (
          <>
            <h1 role="status">Getting your profile ready…</h1>
            <div aria-hidden="true">
              <CardSkeleton kind="profile" />
            </div>
          </>
        ) : (
          <OnboardingForm
            initial={profile}
            complete={() => {
              history.replaceState(
                {},
                "",
                /^\/circles\/invite\/[A-Za-z0-9_-]{43}$/.test(
                  sessionStorage.getItem("walletwise:circle-invite") || "",
                )
                  ? sessionStorage.getItem("walletwise:circle-invite")!
                  : "/#Home",
              );
              setSaved(true);
              setProfile(undefined);
              setAttempt((value) => value + 1);
            }}
          />
        )}
      </section>
    </main>
  );
}
