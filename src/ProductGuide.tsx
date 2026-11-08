import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { State } from "../shared/types";
import type { CoachResult } from "../shared/coach";
import { api } from "./api";
import { Button, PanelHead } from "./ui";
export function ProductGuide({
  state,
  page,
  onNavigate,
  onFund,
  onGoal,
  onPurchase,
  onSavings,
}: {
  state: State;
  page: string;
  onNavigate: (p: "My Wallet" | "Savings Circles") => void;
  onFund: () => void;
  onGoal: () => void;
  onPurchase: () => void;
  onSavings: () => void;
}) {
  const [data, setData] = useState<CoachResult>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const resume = useRef(
    new URLSearchParams(location.search).get("guide") === "resume",
  );
  useEffect(() => {
    if (resume.current) {
      const url = new URL(location.href);
      url.searchParams.delete("guide");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<CoachResult>("/savings/coach", undefined, "GET", {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted && r?.guide && r?.steps) setData(r);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [state.dashboard, state.balances]);
  useEffect(() => {
    if (page !== "My Wallet" && page !== "Savings Circles") return;
    const field = page === "My Wallet" ? "walletViewed" : "circlesViewed";
    void api("/guide", { [field]: true }, "PUT")
      .then(() =>
        setData((d) =>
          d ? { ...d, guide: { ...d.guide, [field]: true } } : d,
        ),
      )
      .catch(() => {});
  }, [page]);
  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/guide", { dismissed: true }, "PUT");
      setData((d) =>
        d ? { ...d, guide: { ...d.guide, dismissed: true } } : d,
      );
      resume.current = false;
    } catch {
      setError("Your guide preference could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (page !== "Home" || !data) return null;
  const steps = [
    {
      name: "Explore your wallet",
      done: data.guide.walletViewed,
      action: () => onNavigate("My Wallet"),
      detail: "See your separate available and saved balances.",
    },
    {
      name: "Add Sandbox funds",
      done: data.steps.funded,
      action: onFund,
      detail: "Use a PayPal Sandbox personal account to fund your test wallet.",
    },
    {
      name: "Create a savings goal",
      done: data.steps.goal,
      action: onGoal,
      detail: "Give your savings a purpose and choose a target.",
    },
    {
      name: "Enable Smart Savings",
      done: data.steps.enabled,
      action: onSavings,
      detail: "Choose where future purchase round-ups should go.",
    },
    {
      name: "Simulate a purchase",
      done: data.steps.purchased,
      action: onPurchase,
      detail: "See your purchase and automatic saving recorded separately.",
    },
    {
      name: "Explore Savings Circles (optional)",
      done: data.guide.circlesViewed,
      action: () => onNavigate("Savings Circles"),
      detail: "Discover shared goals and unanimous contributor decisions.",
    },
  ];
  const required = steps.slice(0, 5),
    complete = required.every((s) => s.done),
    current = steps.find((s) => !s.done);
  if ((data.guide.dismissed || complete) && !resume.current) return null;
  return (
    <section className="panel product-guide" aria-label="Getting started guide">
      <PanelHead
        title="Make your first saving"
        subtitle={`${required.filter((s) => s.done).length} of 5 core steps complete - Circle discovery is optional`}
        action={
          <Button secondary disabled={busy} onClick={() => void dismiss()}>
            Skip guide
          </Button>
        }
      />
      {current ? (
        <>
          <h3>{current.name}</h3>
          <p>{current.detail}</p>
          <Button onClick={current.action}>
            {current.name}
            <ChevronRight size={16} />
          </Button>
        </>
      ) : (
        <p>All steps complete. Your test wallet is ready to explore.</p>
      )}
      <details>
        <summary>View your setup checklist</summary>
        <ol>
          {steps.map((s) => (
            <li key={s.name}>
              {s.done && <Check size={14} aria-label="Completed" />}
              <button className="text-link" onClick={s.action}>
                {s.name}
              </button>
              <span>{s.done ? "Complete" : "Not complete"}</span>
            </li>
          ))}
        </ol>
      </details>
      <small>
        Completion comes from recorded account activity. Resume this guide from
        Help Center.
      </small>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
