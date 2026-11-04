import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { State } from "../shared/types";
import type { SavingsQuote, SavingsOptions } from "../shared/circles";
import { currencies, money, type Currency } from "../shared/money";
import { api } from "./api";
import { Button } from "./ui";
import { SavingsSetup } from "./SavingsSetup";
export function GoalPurchase({
  state,
  busy,
  submit,
}: {
  state: State;
  busy: boolean;
  submit: (body: unknown) => Promise<void>;
}) {
  const [currency, setCurrency] = useState<Currency>("ILS"),
    [amount, setAmount] = useState("23.40"),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState("Food & drink");
  const [quote, setQuote] = useState<SavingsQuote | null>(null),
    [saved, setSaved] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [setup, setSetup] = useState(false),
    [skip, setSkip] = useState(false),
    [revision, setRevision] = useState(0);
  const request = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!quote || skip) return;
    const timer = setTimeout(
      () => {
        setQuote(null);
        setError(
          "The savings quote expired. Refresh the preview, or explicitly continue without a round-up.",
        );
      },
      Math.max(0, Date.parse(quote.expires_at) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [quote, skip]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setQuote(null);
    setError("");
    if (skip) {
      setSaved(0);
      setLoading(false);
      return;
    }
    const timer = setTimeout(
      () =>
        void api<SavingsOptions>("/savings/options", undefined, "GET")
          .then(async (options) => {
            const profileEnabled =
              state.preferences.savings === "enabled" &&
              state.savingsRuleEnabled?.[currency] !== false;
            if (
              profileEnabled &&
              !options.options.some(
                (o) =>
                  o.kind === options.destination?.kind &&
                  o.id === options.destination?.id,
              )
            ) {
              if (active) setSetup(true);
              return;
            }
            const value = await api<{
              quote: SavingsQuote | null;
              saved: number;
            }>("/savings/preview", { currency, amount, purchase: true });
            if (active) {
              setQuote(value.quote);
              setSaved(value.saved);
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      300,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currency, amount, skip, revision, state.preferences.savings]);
  function change(work: () => void) {
    work();
    request.current = crypto.randomUUID();
  }
  if (setup)
    return (
      <SavingsSetup
        onDone={() => {
          setSetup(false);
          setSkip(false);
          setRevision((v) => v + 1);
        }}
        onSkip={() => {
          setSetup(false);
          setSkip(true);
        }}
      />
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          requestId: request.current,
          currency,
          amount,
          description,
          category,
          quoteId: quote?.id ?? null,
          skipSavings: skip,
        });
      }}
    >
      <p className="muted">
        A simulated purchase from your available wallet. No PayPal charge is
        made.
      </p>
      <label>
        Merchant or description
        <input
          required
          maxLength={80}
          value={description}
          onChange={(e) => change(() => setDescription(e.target.value))}
        />
      </label>
      <div className="form-grid">
        <label>
          Currency
          <select
            aria-label="currency"
            value={currency}
            disabled={busy}
            onChange={(e) =>
              change(() => setCurrency(e.target.value as Currency))
            }
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Purchase amount
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => change(() => setAmount(e.target.value))}
          />
        </label>
      </div>
      <label>
        Category
        <select
          value={category}
          onChange={(e) => change(() => setCategory(e.target.value))}
        >
          {[
            "Food & drink",
            "Shopping",
            "Transport",
            "Education",
            "Bills",
            "Other",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="preview-box">
        <div className="row between">
          <span>Automatic savings</span>
          <strong>{money(skip ? 0 : saved, currency)}</strong>
        </div>
        {loading ? (
          <p role="status">Checking savings destination…</p>
        ) : skip ? (
          <p role="status">No round-up will be deducted from this purchase.</p>
        ) : quote ? (
          <p>
            {money(Number(quote.target_minor), quote.target_currency)} credited
            to your{" "}
            {quote.destination_kind === "circle"
              ? "Savings Circle"
              : "default goal"}
            .{" "}
            {currency !== quote.target_currency && (
              <>
                Rate: {(Number(quote.rate_units) / 1000000).toFixed(6)} · Fee:{" "}
                {money(Number(quote.fee_minor), currency)} · Simulated
                conversion.
              </>
            )}
          </p>
        ) : (
          <p>Automatic savings is inactive for this purchase.</p>
        )}
        <small>Available: {money(state.balances[currency], currency)}</small>
      </div>
      {error && (
        <>
          <p role="alert" className="error">
            {error}
          </p>
          <div className="actions">
            <Button
              secondary
              disabled={busy}
              onClick={() => setRevision((v) => v + 1)}
            >
              Retry savings preview
            </Button>
            <Button
              secondary
              disabled={busy}
              onClick={() => change(() => setSkip(true))}
            >
              Continue without a round-up
            </Button>
          </div>
        </>
      )}
      <Button type="submit" disabled={busy || loading || !!error}>
        {busy ? "Processing…" : "Complete simulated purchase"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}
