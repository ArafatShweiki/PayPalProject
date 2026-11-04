import { DeferredSection } from "./DeferredSection";
import { snapshotRate } from "../shared/market";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  CreditCard,
  Target,
  ChevronRight,
} from "lucide-react";
import { api } from "./api";
import {
  currencies,
  money,
  minor,
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
            ) : e.kind === "refund" ||
              e.kind === "opening" ||
              e.kind === "funding" ? (
              <ArrowDownLeft size={18} />
            ) : (
              <CreditCard size={18} />
            )}
          </span>
          <span className="transaction-name">
            <strong>{e.description}</strong>
            {e.status && (
              <small>
                {e.status} · {e.fundingSource}
              </small>
            )}
            <small>
              {e.category} · {date(e.at)}
            </small>
          </span>
          <span className="transaction-value">
            <strong>
              {e.kind === "refund" ||
              e.kind === "opening" ||
              e.kind === "funding"
                ? "+"
                : "−"}
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
    <Empty>No transactions yet. Add funds to get started.</Empty>
  );
}
export function Activity({
  state,
  onSelect,
  onFilter,
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  onFilter?: (
    currency: string,
    category: string,
    from: string,
    to: string,
  ) => void;
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
        (currency === "all" ||
          e.currency === currency ||
          e.to === currency ||
          e.postings.some((posting) => posting.currency === currency)) &&
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
            onChange={(e) => {
              setCurrency(e.target.value);
              onFilter?.(e.target.value, category, from, to);
            }}
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
            onChange={(e) => {
              setCategory(e.target.value);
              onFilter?.(currency, e.target.value, from, to);
            }}
          >
            <option value="all">All categories</option>
            {[
              ...new Set([
                "Food & drink",
                "Groceries",
                "Transport",
                "Shopping",
                "Bills",
                "Entertainment",
                "Health",
                "Education",
                "Other",
                "Funding",
                "Conversion",
                ...state.ledger.map((e) => e.category),
              ]),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              onFilter?.(currency, category, e.target.value, to);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              onFilter?.(currency, category, from, e.target.value);
            }}
          />
        </label>
      </div>
      <DeferredSection
        label="wallet activity"
        loading={loading}
        error={error}
        retry={retry}
      >
        <Transactions entries={entries} onSelect={onSelect} />
      </DeferredSection>
    </>
  );
}
export function GoalForm({
  busy,
  submit,
  requireDefault = false,
}: {
  busy: boolean;
  requireDefault?: boolean;
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
          makeDefault: requireDefault || new FormData(f).has("makeDefault"),
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
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="makeDefault"
          defaultChecked={requireDefault}
          disabled={busy || requireDefault}
        />
        Make this my default savings goal
      </label>
      <Button disabled={busy} type="submit">
        Create savings goal
      </Button>
    </form>
  );
}
export function TransactionDetails({
  entry: e,
  goals = [],
}: {
  entry: Entry;
  goals?: Goal[];
}) {
  return (
    <>
      <div className="detail-amount">{money(e.amount, e.currency)}</div>
      <dl>
        <dt>Description</dt>
        <dd>{e.description}</dd>
        <dt>Type</dt>
        <dd>{e.kind === "funding" ? "Funds Added" : e.kind} · test wallet</dd>
        {e.status && (
          <>
            <dt>Status</dt>
            <dd>{e.status}</dd>
            <dt>Funding source</dt>
            <dd>{e.fundingSource}</dd>
            <dt>Transaction reference</dt>
            <dd>{e.reference}</dd>
          </>
        )}
        <dt>Date</dt>
        <dd>{time(e.at)}</dd>
        {e.saving && (
          <>
            <dt>Savings credit</dt>
            <dd>
              {money(Number(e.saving.target_minor), e.saving.target_currency)}
              {e.circleId ? " ? Savings Circle" : " ? Personal goal"}
            </dd>
            <dt>Conversion rate</dt>
            <dd>
              {(Number(e.saving.rate_units) / 1000000).toFixed(6)} ? Simulated
            </dd>
            <dt>Quote time</dt>
            <dd>{new Date(e.saving.observed_at).toLocaleString()}</dd>
            <dt>Conversion fee</dt>
            <dd>
              {money(Number(e.saving.fee_minor), e.saving.source_currency)}
            </dd>
          </>
        )}
        <dt>Round-up</dt>
        <dd>{money(e.saved, e.currency)}</dd>
        {e.saved > 0 && (
          <>
            <dt>Savings destination</dt>
            <dd>
              {e.goalId
                ? (goals.find((g) => g.id === e.goalId)?.name ??
                  "Previous savings goal")
                : e.circleId
                  ? "Savings Circle"
                  : "Historical unassigned savings"}
            </dd>
          </>
        )}
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
        {e.circleId
          ? "Refunding the purchase returns only the merchant amount. Its Circle contribution stays locked; a return requires unanimous contributor approval in Savings Circles."
          : "Full purchase refunds reverse both the purchase and its exact original savings allocation."}
      </p>
    </>
  );
}
export function Conversion({
  state,
  busy,
  run,
  onAddFunds,
  initialTo = "ILS",
}: {
  state: State;
  busy: boolean;
  run: Runner;
  onAddFunds?: () => void;
  initialTo?: Currency;
}) {
  const [from, setFrom] = useState<Currency>("USD");
  const [to, setTo] = useState<Currency>(initialTo);
  const conversionPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialTo === "JOD") conversionPanel.current?.focus();
  }, [initialTo]);
  const [amount, setAmount] = useState("100.00");
  let insufficient = false;
  try {
    insufficient = minor(amount, from) > state.balances[from];
  } catch {
    /* form validation handles invalid amounts */
  }
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
    <section
      className="panel"
      ref={conversionPanel}
      tabIndex={-1}
      aria-label="Currency conversion"
    >
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
              disabled={busy || insufficient}
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
        {insufficient && (
          <p>
            Insufficient {from} balance.{" "}
            {from !== "JOD" && onAddFunds && (
              <button className="text-link" type="button" onClick={onAddFunds}>
                Add Funds
              </button>
            )}
          </p>
        )}
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
                {quote.method ?? "Indicative provider rate"} - quote time{" "}
                {time(quote.observedAt ?? quote.fetchedAt)}
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
              {
                "A recent provider observation is required. No invented exchange rates."
              }
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
