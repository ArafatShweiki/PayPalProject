import { snapshotRate } from "../shared/market";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Target,
  ChevronRight,
} from "lucide-react";
import { api } from "./api";
import {
  currencies,
  money,
  minor,
  roundUp,
  convert,
  type Currency,
} from "../shared/money";
import type { State, Entry, Goal } from "../shared/types";
import {
  Button,
  Empty,
  CurrencySelect,
  PanelHead,
  date,
  time,
  field,
  type Runner,
} from "./ui";

export function GoalCard({
  goal,
  saved,
  active,
  onSelect,
}: {
  goal: Goal;
  saved: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="goal-card">
      <div className="row between">
        <span className="icon-tile">
          <Target size={20} />
        </span>
        <span className={active ? "pill green" : "pill"}>
          {active ? "Selected destination" : goal.currency}
        </span>
      </div>
      <h3>{goal.name}</h3>
      <p>
        <strong>{money(saved, goal.currency)}</strong>
        <span> / {money(goal.target, goal.currency)}</span>
      </p>
      <progress value={Math.min(saved, goal.target)} max={goal.target} />
      <div className="row between">
        <small>{Math.floor((saved / goal.target) * 100)}% of goal</small>
        {!active && (
          <button className="text-link" onClick={onSelect}>
            Select goal
          </button>
        )}
      </div>
      <small>
        Created {date(goal.createdAt)}
        {goal.targetDate && ` · Target ${date(goal.targetDate)}`}
      </small>
    </div>
  );
}

export function Transactions({
  entries,
  onSelect,
}: {
  entries: Entry[];
  onSelect: (e: Entry) => void;
}) {
  return entries.length ? (
    <div className="transactions">
      {entries.map((e) => (
        <button className="transaction" key={e.id} onClick={() => onSelect(e)}>
          <span className={`transaction-icon ${e.kind}`}>
            {e.kind === "conversion" ? (
              <ArrowLeftRight size={18} />
            ) : e.kind === "refund" || e.kind === "opening" ? (
              <ArrowDownLeft size={18} />
            ) : (
              <CreditCard size={18} />
            )}
          </span>
          <span className="transaction-name">
            <strong>{e.description}</strong>
            <small>
              {e.category} · {date(e.at)}
            </small>
          </span>
          <span className="transaction-value">
            <strong>
              {e.kind === "refund" || e.kind === "opening" ? "+" : "−"}
              {money(e.amount, e.currency)}
            </strong>
            {(e.saved > 0 || e.kind === "conversion") && (
              <small>
                {e.saved > 0
                  ? `${e.kind === "refund" ? "Reversed" : "Saved"} ${money(e.saved, e.currency)}`
                  : `+${money(e.received!, e.to!)}`}
              </small>
            )}
          </span>
          <ChevronRight size={14} />
        </button>
      ))}
    </div>
  ) : (
    <Empty>Your next step starts the story. Try a simulated purchase.</Empty>
  );
}

export function Activity({
  state,
  onSelect,
}: {
  state: State;
  onSelect: (e: Entry) => void;
}) {
  const [currency, setCurrency] = useState("all");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const entries = state.ledger
    .filter(
      (e) =>
        (currency === "all" || e.currency === currency || e.to === currency) &&
        (category === "all" || e.category === category) &&
        (!from || e.at.slice(0, 10) >= from) &&
        (!to || e.at.slice(0, 10) <= to),
    )
    .slice()
    .reverse();
  return (
    <>
      <div className="filters">
        <label>
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="all">All currencies</option>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {[...new Set(state.ledger.map((e) => e.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <Transactions entries={entries} onSelect={onSelect} />
    </>
  );
}

export function PurchaseForm({
  state,
  busy,
  submit,
}: {
  state: State;
  busy: boolean;
  submit: (body: unknown) => Promise<void>;
}) {
  const [currency, setCurrency] = useState<Currency>("ILS");
  const [amount, setAmount] = useState("23.40");
  const key = useRef(crypto.randomUUID());
  let saved = 0;
  try {
    if (state.preferences.savings === "enabled")
      saved = roundUp(
        minor(amount, currency),
        state.preferences.increments[currency],
        state.preferences.caps[currency],
      );
  } catch {
    /* Preview waits for valid input. */
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          requestId: key.current,
          currency,
          amount,
          description: field(e.currentTarget, "description"),
          category: field(e.currentTarget, "category"),
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
          name="description"
          required
          maxLength={80}
          placeholder="e.g. Corner coffee"
        />
      </label>
      <div className="form-grid">
        <label>
          Currency
          <CurrencySelect
            value={currency}
            onChange={(c) => {
              setCurrency(c);
              key.current = crypto.randomUUID();
            }}
          />
        </label>
        <label>
          Purchase amount
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              key.current = crypto.randomUUID();
            }}
          />
        </label>
      </div>
      <label>
        Category
        <select name="category">
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
          <strong>{money(saved, currency)}</strong>
        </div>
        <p>
          {state.preferences.savings === "enabled"
            ? "Allocated automatically when this purchase succeeds."
            : "Smart Savings is not active. You can enable it from Smart Savings or Settings."}
        </p>
        <small>Available: {money(state.balances[currency], currency)}</small>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Processing…" : "Complete simulated purchase"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}

export function GoalForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (body: unknown) => Promise<void>;
}) {
  const key = useRef(crypto.randomUUID());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget;
        void submit({
          requestId: key.current,
          name: field(f, "name"),
          currency: field(f, "currency"),
          amount: field(f, "amount"),
          ...(field(f, "targetDate")
            ? { targetDate: field(f, "targetDate") }
            : {}),
        });
      }}
    >
      <label>
        Goal name
        <input
          name="name"
          required
          maxLength={60}
          placeholder="A new laptop, a trip, a little peace of mind…"
        />
      </label>
      <div className="form-grid">
        <label>
          Currency
          <CurrencySelect />
        </label>
        <label>
          Target amount
          <input
            name="amount"
            inputMode="decimal"
            required
            placeholder="1500.00"
          />
        </label>
      </div>
      <label>
        Target date (optional)
        <input name="targetDate" type="date" />
      </label>
      <p className="footnote">
        Future round-ups in this currency go to this goal. Existing savings stay
        in their original destination.
      </p>
      <Button disabled={busy} type="submit">
        Create savings goal
      </Button>
    </form>
  );
}

export function TransactionDetails({ entry: e }: { entry: Entry }) {
  return (
    <>
      <div className="detail-amount">{money(e.amount, e.currency)}</div>
      <dl>
        <dt>Description</dt>
        <dd>{e.description}</dd>
        <dt>Type</dt>
        <dd>{e.kind} · simulated</dd>
        <dt>Date</dt>
        <dd>{time(e.at)}</dd>
        <dt>Round-up</dt>
        <dd>{money(e.saved, e.currency)}</dd>
        {e.observedAt && (
          <>
            <dt>Market quote time</dt>
            <dd>{time(e.observedAt)}</dd>
            <dt>Rate method</dt>
            <dd>{e.method}</dd>
            <dt>Simulated fee / spread</dt>
            <dd>
              {e.simulatedFee ?? 0} / {e.simulatedSpread ?? 0}
            </dd>
          </>
        )}
        <dt>Record ID</dt>
        <dd className="mono">{e.id}</dd>
        {e.rate && (
          <>
            <dt>Recorded rate</dt>
            <dd>{(e.rate / 1000000).toFixed(6)} · midpoint before fees</dd>
            <dt>Observation</dt>
            <dd className="mono">{e.snapshotId}</dd>
          </>
        )}
      </dl>
      <h3>Balanced ledger postings</h3>
      {e.postings.map((p, i) => (
        <div className="row between posting" key={i}>
          <span>{p.account}</span>
          <strong>{money(p.amount, p.currency)}</strong>
        </div>
      ))}
      <p className="footnote">
        Full purchase refunds reverse both the purchase and its exact original
        savings allocation.
      </p>
    </>
  );
}

export function Conversion({
  state,
  busy,
  run,
}: {
  state: State;
  busy: boolean;
  run: Runner;
}) {
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>("ILS");
  const [amount, setAmount] = useState("100.00");
  const [quote, setQuote] = useState<{
    received: number;
    rate: number;
    snapshotId: string;
    fetchedAt: string;
    observedAt?: string;
    source?: string;
    method?: string;
    simulatedFee?: number;
    simulatedSpread?: number;
    expiresAt: string;
  } | null>(null);
  const [quoteNotice, setQuoteNotice] = useState("");
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!quote) return;
    const expires = Date.parse(quote.expiresAt) - Date.now();
    const latest = state.snapshots.at(-1);
    const invalidate = () => {
      setQuote(null);
      setQuoteNotice(
        "The quote expired or its rate changed. Preview again and confirm the new quote.",
      );
    };
    if (
      !busy &&
      (expires <= 0 ||
        (latest && snapshotRate(latest, from, to) !== quote.rate))
    ) {
      invalidate();
      return;
    }
    const timer = setTimeout(
      () => {
        if (!busy) invalidate();
      },
      Math.max(0, expires),
    );
    return () => clearTimeout(timer);
  }, [quote, state.snapshots, from, to, busy]);
  const reset = () => {
    setQuote(null);
    setQuoteNotice("");
    key.current = crypto.randomUUID();
  };
  const reference = state.snapshots[0];
  let difference: number | undefined;
  try {
    if (quote && reference && reference.id !== quote.snapshotId)
      difference =
        quote.received -
        convert(
          minor(amount, from),
          from,
          to,
          snapshotRate(reference, from, to),
        );
  } catch {
    /* Invalid input is checked by the server. */
  }
  return (
    <section className="panel">
      <PanelHead
        title="Move between your currencies"
        subtitle="Preview first. Confirm when you’re ready."
      />
      <div className="conversion-layout">
        <div>
          <div className="form-grid">
            <label>
              From
              <CurrencySelect
                name="Source currency"
                value={from}
                onChange={(c) => {
                  setFrom(c);
                  reset();
                }}
              />
            </label>
            <label>
              To
              <CurrencySelect
                name="Target currency"
                value={to}
                onChange={(c) => {
                  setTo(c);
                  reset();
                }}
              />
            </label>
          </div>
          <label>
            Amount to convert
            <input
              aria-label="Amount to convert"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                reset();
              }}
            />
          </label>
          <small>Available: {money(state.balances[from], from)}</small>
          <div className="actions">
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const revision = key.current;
                  const q = await api<NonNullable<typeof quote>>(
                    "/conversions/preview",
                    { from, to, amount },
                  );
                  if (revision === key.current) {
                    setQuote(q);
                    setQuoteNotice("");
                  }
                }, "Conversion preview ready.")
              }
            >
              <ArrowLeftRight size={16} />
              Preview conversion
            </Button>
          </div>
        </div>
        <div className="conversion-result">
          {quoteNotice && <p role="status">{quoteNotice}</p>}
          <span className="eyebrow">ESTIMATED RECEIVED · BEFORE FEES</span>
          <h2>{quote ? money(quote.received, to) : "—"}</h2>
          {quote ? (
            <>
              <p>
                1 {from} ≈ {(quote.rate / 1000000).toFixed(6)} {to}
              </p>
              <small>
                {state.authMode === "demo" && state.demoMarketMode !== "live"
                  ? "Simulated midpoint"
                  : (quote.method ?? "Indicative provider rate")}{" "}
                - quote time {time(quote.observedAt ?? quote.fetchedAt)}
                {quote.source && (
                  <a
                    className="text-link"
                    href={quote.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View quote source
                  </a>
                )}
              </small>
              <p>
                {difference !== undefined
                  ? `${money(difference, to)} change compared with the first observation. Not guaranteed profit.`
                  : "No earlier reference observation for comparison."}
              </p>
              <small>
                Simulated fee: 0. Simulated spread: 0. Real execution costs
                unknown. Expires {time(quote.expiresAt)}.
              </small>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api("/conversions", {
                        from,
                        to,
                        amount,
                        rate: quote.rate,
                        snapshotId: quote.snapshotId,
                        expiresAt: quote.expiresAt,
                        requestId: key.current,
                      }),
                    "Simulated exchange completed.",
                  ).then((ok) => {
                    if (ok) reset();
                  })
                }
              >
                Confirm simulated exchange <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <p>
              {state.authMode === "demo" && state.demoMarketMode !== "live"
                ? "Preview a conversion using explicitly selected sample rates. No money is exchanged."
                : "A recent provider observation is required. No invented exchange rates."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function Sandbox({
  state,
  busy,
  run,
}: {
  state: State;
  busy: boolean;
  run: Runner;
}) {
  const key = useRef(crypto.randomUUID());
  return (
    <section className="panel">
      <PanelHead
        title="PayPal test payment"
        subtitle="A separate $1.00 USD test merchant payment. Never credited to this wallet."
      />
      <p>
        {state.capabilities.paypal
          ? "Use a PayPal test account to approve the payment, then return here to check its status. No real funds move."
          : "Test payments are currently unavailable. Your wallet features remain available."}
      </p>
      <Button
        secondary
        disabled={busy || !state.capabilities.paypal}
        onClick={() =>
          void run(async () => {
            const order = await api<{ approvalUrl: string }>("/paypal/orders", {
              requestId: key.current,
            });
            location.assign(order.approvalUrl);
          }, "Opening PayPal test payment…")
        }
      >
        Continue to PayPal <ArrowUpRight size={16} />
      </Button>
      {state.sandbox.map((o) => (
        <div className="alert-row" key={o.id}>
          <div>
            <strong>{o.status} · USD 1.00</strong>
            <small>
              Order {o.id}
              {o.captureId && ` · Capture ${o.captureId}`}
            </small>
          </div>
          {o.status !== "COMPLETED" && o.status !== "CANCELED" && (
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void run(
                  () => api(`/paypal/${o.id}/capture`, {}),
                  "Test payment status checked.",
                )
              }
            >
              Check payment status
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
