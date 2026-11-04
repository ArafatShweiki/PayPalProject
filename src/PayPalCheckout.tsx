import { useEffect, useRef, useState } from "react";
import { loadPayPalSdk } from "./paypal-sdk";
import { ApiError } from "./errors";

export function PayPalCheckout(props: {
  clientId: string;
  currency: string;
  disabled: boolean;
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (data: { orderId: string }) => Promise<void>;
  onCancel: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const locked = useRef(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    callbacks.current = props;
  });
  useEffect(() => {
    let active = true;
    const host = container.current!;
    setReady(false);
    setFailed(false);
    void (async () => {
      const sdk = await loadPayPalSdk();
      const instance = await sdk.createInstance({
        clientId: props.clientId,
        components: ["paypal-payments"],
        pageType: "checkout",
      });
      const methods = await instance.findEligibleMethods({
        currencyCode: props.currency,
      });
      if (!methods.isEligible("paypal"))
        throw new Error(
          "PayPal Checkout is unavailable for this browser or currency.",
        );
      if (!active) return;
      const session = await instance.createPayPalOneTimePaymentSession({
        onApprove: async (data) => {
          try {
            await callbacks.current.onApprove(data);
          } catch {
            callbacks.current.onError(
              "Payment verification could not finish. Check payment status before trying again.",
            );
          } finally {
            locked.current = false;
          }
        },
        onCancel: async () => {
          try {
            await callbacks.current.onCancel();
          } catch {
            callbacks.current.onError(
              "Cancellation could not be confirmed. Check payment status.",
            );
          } finally {
            locked.current = false;
          }
        },
        onError: () => {
          locked.current = false;
          callbacks.current.onError(
            "PayPal Checkout could not complete. Check payment status before trying again.",
          );
        },
      });
      if (!active) return;
      const button = document.createElement("paypal-button");
      button.setAttribute("aria-label", "Pay with PayPal Sandbox");
      button.addEventListener("click", () => {
        if (callbacks.current.disabled || locked.current) return;
        locked.current = true;
        // Start in the click handler, before awaiting the backend, to retain popup activation.
        void session
          .start({ presentationMode: "auto" }, callbacks.current.createOrder())
          .catch((error: unknown) => {
            locked.current = false;
            callbacks.current.onError(
              error instanceof ApiError
                ? error.message
                : "PayPal Checkout could not start. Check payment status before trying again.",
            );
          });
      });
      host.replaceChildren(button);
      button.toggleAttribute("disabled", callbacks.current.disabled);
      setReady(true);
    })().catch((error: unknown) => {
      if (!active) return;
      setFailed(true);
      callbacks.current.onError(
        error instanceof Error
          ? error.message
          : "PayPal Checkout could not load.",
      );
    });
    return () => {
      active = false;
      host.replaceChildren();
    };
  }, [props.clientId, props.currency, attempt]);
  useEffect(() => {
    container.current?.firstElementChild?.toggleAttribute(
      "disabled",
      props.disabled,
    );
  }, [props.disabled, ready]);
  return (
    <>
      {!ready && !failed && <p role="status">Loading PayPal Checkout...</p>}
      <div ref={container} aria-busy={!ready} />
      {failed && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry PayPal Checkout
        </button>
      )}
    </>
  );
}
