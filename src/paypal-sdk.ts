// PayPal JavaScript SDK v6, loaded only when the authenticated funding dialog opens.
export type CheckoutSession = {
  start: (
    options: { presentationMode: "auto" },
    order: Promise<{ orderId: string }>,
  ) => Promise<void>;
};
type Callbacks = {
  onApprove: (data: { orderId: string }) => Promise<void>;
  onCancel: () => Promise<void>;
  onError: () => void;
};
export type PayPalInstance = {
  findEligibleMethods: (options: {
    currencyCode: string;
  }) => Promise<{ isEligible: (method: string) => boolean }>;
  createPayPalOneTimePaymentSession: (
    callbacks: Callbacks,
  ) => Promise<CheckoutSession>;
};
type PayPalSdk = {
  createInstance: (options: {
    clientId: string;
    components: string[];
    pageType: string;
  }) => Promise<PayPalInstance>;
};
let loading: Promise<PayPalSdk> | undefined;
export function loadPayPalSdk(): Promise<PayPalSdk> {
  return (loading ??= new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.sandbox.paypal.com/web-sdk/v6/core";
    script.async = true;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(
        new Error(
          "PayPal Checkout could not load. Please check your connection and try again.",
        ),
      );
    };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      const sdk = (window as Window & { paypal?: PayPalSdk }).paypal;
      if (sdk?.createInstance) resolve(sdk);
      else fail();
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  }));
}
