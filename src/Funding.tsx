import { useEffect, useRef, useState } from "react";
import type { FundingOrder } from "../shared/types";
import { money, minor } from "../shared/money";
import { api } from "./api";
import { Button } from "./ui";
import { userFacingMessage } from "./errors";
import { PayPalCheckout } from "./PayPalCheckout";
export function Funding({
  onClose,
  onUpdated,
}: {
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [config, setConfig] = useState<{
    available: boolean;
    clientId?: string;
    unavailableReason?: string;
    currencies: ("USD" | "ILS")[];
    maxMinor: number;
    orders: FundingOrder[];
  }>();
  const [currency, setCurrency] = useState<"USD" | "ILS">("USD"),
    [amount, setAmount] = useState("50.00"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef<FundingOrder | undefined>(undefined);
  const key = useRef(crypto.randomUUID());
  const load = () =>
    api<NonNullable<typeof config>>("/funding").then((value) => {
      setConfig(value);
      setCurrency((current) =>
        value.currencies.includes(current)
          ? current
          : value.currencies[0] || "USD",
      );
    });
  useEffect(() => {
    void load().catch(() =>
      setError(
        "Adding funds is currently unavailable. Please try again later.",
      ),
    );
  }, []);
  async function perform(work: () => Promise<FundingOrder>) {
    setBusy(true);
    setError("");
    try {
      const order = await work();
      setMessage(
        order.status === "COMPLETED"
          ? `${money(Number(order.amount_minor), order.currency)} added to your wallet. PayPal reference: ${order.capture_id || order.provider_order_id || order.id}.`
          : order.status === "CANCELED"
            ? "Checkout canceled. No funds were added."
            : `Payment status: ${order.status}. Check payment status for updates.`,
      );
      if (["COMPLETED", "CANCELED", "FAILED"].includes(order.status)) {
        key.current = crypto.randomUUID();
        pending.current = undefined;
      }
      await load();
      await onUpdated();
    } catch (e) {
      setError(
        userFacingMessage(
          e instanceof Error
            ? e.message
            : "The payment could not be completed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  let parsed: number | null = null;
  try {
    parsed = minor(amount, currency);
  } catch {
    /* validated below and on the server */
  }
  const valid =
    parsed !== null && parsed >= 100 && parsed <= (config?.maxMinor || 0);
  return (
    <>
      <div className="sandbox-guidance">
        <strong>PayPal Sandbox - test funds only</strong>
        <p>
          Use a Sandbox personal account created in the PayPal Developer
          Dashboard. A regular PayPal account cannot sign in to Sandbox
          Checkout. PayPal sign-in and wallet funding are separate operations.
        </p>
        <small>
          Your wallet is credited only after server verification. If checkout is
          interrupted, check the existing payment status before starting again.
          No real money is deposited or paid out.
        </small>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="banner">
          {message}
        </p>
      )}
      {!config && !error && <p role="status">Loading funding options...</p>}
      {config && !config.available && (
        <p role="status">
          {config.unavailableReason ||
            "Adding funds is currently unavailable. Your wallet remains available."}
        </p>
      )}
      {config?.available && (
        <form onSubmit={(e) => e.preventDefault()}>
          <div className="form-grid">
            <label>
              Currency
              <select
                aria-label="Funding currency"
                value={currency}
                disabled={busy}
                onChange={(e) => {
                  setCurrency(e.target.value as "USD" | "ILS");
                  key.current = crypto.randomUUID();
                  setError("");
                }}
              >
                {config.currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input
                aria-label="Funding amount"
                inputMode="decimal"
                value={amount}
                disabled={busy}
                required
                onChange={(e) => {
                  setAmount(e.target.value);
                  key.current = crypto.randomUUID();
                }}
              />
            </label>
          </div>
          <p>
            PayPal checkout. Limit: {money(100, currency)}–
            {money(config.maxMinor, currency)}.
          </p>
          <p>Your wallet is credited after successful payment confirmation.</p>
          <div className="actions">
            {config.clientId ? (
              <PayPalCheckout
                key={currency}
                clientId={config.clientId}
                currency={currency}
                disabled={busy || !valid}
                createOrder={async () => {
                  if (!valid || busy)
                    throw new Error("Choose a valid funding amount.");
                  setBusy(true);
                  setError("");
                  setMessage("");
                  const order = await api<FundingOrder>("/funding/orders", {
                    requestId: key.current,
                    currency,
                    amount,
                  });
                  pending.current = order;
                  if (!order.provider_order_id || order.status !== "CREATED")
                    throw new Error(
                      "Check the existing payment status before starting checkout.",
                    );
                  return { orderId: order.provider_order_id };
                }}
                onApprove={async ({ orderId }) => {
                  const order = pending.current;
                  if (!order || order.provider_order_id !== orderId)
                    throw new Error(
                      "Payment approval did not match this request.",
                    );
                  await perform(() => api(`/funding/${order.id}/capture`, {}));
                }}
                onCancel={async () => {
                  const order = pending.current;
                  if (order)
                    await perform(() => api(`/funding/${order.id}/cancel`, {}));
                  else {
                    setBusy(false);
                    setMessage("Checkout canceled. No funds were added.");
                  }
                }}
                onError={(detail) => {
                  setBusy(false);
                  setError(detail);
                  void load().catch(() => undefined);
                }}
              />
            ) : (
              <p role="alert">
                PayPal Checkout configuration is unavailable. Please reopen this
                dialog.
              </p>
            )}
            {busy && <p role="status">Processing PayPal Checkout...</p>}
            <Button secondary disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!config?.available && (
        <Button secondary onClick={onClose}>
          Close
        </Button>
      )}
      {!!config?.orders.length && (
        <section>
          <h3>Funding activity</h3>
          {config.orders.map((o) => (
            <div className="alert-row" key={o.id}>
              <div>
                <strong>
                  {money(Number(o.amount_minor), o.currency)} · {o.status}
                </strong>
                <small>
                  {new Date(o.created_at).toLocaleString()} · PayPal ·{" "}
                  {o.capture_id || o.provider_order_id || o.id}
                </small>
              </div>
              {o.provider_order_id && (
                <div className="actions">
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        api(
                          `/funding/${o.id}/${["CREATED", "PENDING", "RECONCILE"].includes(o.status) && !o.transaction_id ? "capture" : "reconcile"}`,
                          {},
                        ),
                      )
                    }
                  >
                    Check payment status
                  </Button>
                  {["CREATED", "PENDING", "RECONCILE"].includes(o.status) && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() =>
                        void perform(() => api(`/funding/${o.id}/cancel`, {}))
                      }
                    >
                      Cancel payment
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
