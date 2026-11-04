import { useEffect, useState, type FormEvent } from "react";
import { Check, Download } from "lucide-react";
import { currencies, decimal, minor, type Currency } from "../shared/money";
import type { State, Preferences, Report } from "../shared/types";
import { Button, PanelHead, time, field } from "./ui";

export function SettingsForm({
  state,
  busy,
  save,
}: {
  state: State;
  busy: boolean;
  save: (p: Partial<Preferences>) => Promise<boolean>;
}) {
  const [localError, setLocalError] = useState("");
  const p = state.preferences;
  const [savingsEnabled, setSavingsEnabled] = useState(p.savings === "enabled");
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    p.notifications,
  );
  useEffect(() => {
    setSavingsEnabled(p.savings === "enabled");
    setNotificationsEnabled(p.notifications);
  }, [p]);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    try {
      const increments = { ...p.increments };
      for (const c of currencies) {
        increments[c] = minor(field(f, `increment-${c}`), c);
      }
      setLocalError("");
      void save({
        name: field(f, "name"),
        preferred: field(f, "preferred") as Currency,
        savings: field(f, "enabled") === "on" ? "enabled" : "disabled",
        frequency: field(f, "frequency") as Preferences["frequency"],
        notifications: field(f, "notifications") === "on",
        increments,
        caps: p.caps,
      });
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  return (
    <form className="panel" key={JSON.stringify(p)} onSubmit={submit}>
      <PanelHead
        title="Your preferences"
        subtitle="Changes apply to future activity only."
      />
      {localError && (
        <p role="alert" className="error">
          {localError}
        </p>
      )}
      <div className="form-grid">
        <label>
          Display name
          <input name="name" defaultValue={p.name} required maxLength={60} />
        </label>
        <label>
          Preferred display currency
          <select name="preferred" defaultValue={p.preferred}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="section-label">Smart Savings</h3>
      <label className="check">
        <input
          type="checkbox"
          name="enabled"
          checked={savingsEnabled}
          onChange={(e) => setSavingsEnabled(e.target.checked)}
          disabled={busy}
        />
        Automatically allocate round-ups after successful simulated purchases
      </label>
      <div className="rules-grid">
        {currencies.map((c) => (
          <div className="rule" key={c}>
            <strong>{c} rule</strong>
            <label>
              Round-up increment
              <input
                name={`increment-${c}`}
                inputMode="decimal"
                defaultValue={decimal(p.increments[c], c)}
                required
              />
            </label>
            <small>
              {c === "ILS"
                ? "Try 5, 10, or 20 shekels"
                : c === "JOD"
                  ? "Try 0.100, 0.500, or 1.000 dinar"
                  : "Try 1, 2, or 5 dollars"}
            </small>
          </div>
        ))}
      </div>
      <p className="footnote">
        Exact multiples save zero. If the available balance cannot cover both
        the purchase and its round-up, the entire operation is declined.
        Personal-goal refunds reverse the recorded savings. Circle savings
        remain locked until an approved return.
      </p>
      <h3 className="section-label">Reports & notifications</h3>
      <label>
        Report frequency
        <select name="frequency" defaultValue={p.frequency}>
          <option value="weekly">Weekly (7 calendar days)</option>
          <option value="monthly">Monthly (calendar month)</option>
        </select>
      </label>
      <label className="check">
        <input
          name="notifications"
          type="checkbox"
          checked={notificationsEnabled}
          onChange={(e) => setNotificationsEnabled(e.target.checked)}
          disabled={busy}
        />
        Enable in-app currency notifications
      </label>
      <div className="actions">
        <Button disabled={busy} type="submit">
          Save preferences <Check size={16} />
        </Button>
      </div>
    </form>
  );
}

export function ReportArchive({ reports }: { reports: Report[] }) {
  function download(r: Report) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `dream-piggy-bank-${r.frequency}-${r.at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      {reports.map((r) => (
        <details key={r.id}>
          <summary>
            {r.frequency === "weekly" ? "Weekly" : "Monthly"} review ·{" "}
            {time(r.at)} ·{" "}
            {r.source === "Gemini" ? "AI explanation" : "Calculated summary"}
          </summary>
          {r.observations.map((o, i) => (
            <p key={i}>{o}</p>
          ))}
          <Button secondary onClick={() => download(r)}>
            <Download size={16} />
            Download report
          </Button>
        </details>
      ))}
    </>
  );
}
