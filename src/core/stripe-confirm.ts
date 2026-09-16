/** Wallet buttons that go through Express Checkout Element `onConfirm(event)`. */
export const EXPRESS_CHECKOUT_METHODS = [
  "applePay",
  "googlePay",
  "link",
  "amazonPay",
  "klarna",
] as const;

export type ExpressCheckoutMethod = (typeof EXPRESS_CHECKOUT_METHODS)[number];

export type ExpressCheckoutVisibility = "auto" | "never";

export type ExpressCheckoutPaymentMethods = {
  applePay: ExpressCheckoutVisibility;
  googlePay: ExpressCheckoutVisibility;
  link: ExpressCheckoutVisibility;
  paypal: "never";
  amazonPay: ExpressCheckoutVisibility;
  klarna: ExpressCheckoutVisibility;
};

/** Default: show a wallet only when Stripe says it is available on this device. */
export const DEFAULT_EXPRESS_CHECKOUT_PAYMENT_METHODS: ExpressCheckoutPaymentMethods = {
  applePay: "auto",
  googlePay: "auto",
  link: "auto",
  paypal: "never",
  amazonPay: "auto",
  klarna: "auto",
};

/**
 * Hide Express Checkout wallets whose Stripe payment method is not active.
 * `inactiveTypes` uses Stripe identifiers (`link`, `amazon_pay`, `apple_pay`, …).
 */
export function expressCheckoutPaymentMethods(
  inactiveTypes: Iterable<string>
): ExpressCheckoutPaymentMethods {
  const off = new Set(inactiveTypes);
  const vis = (id: string): ExpressCheckoutVisibility => (off.has(id) ? "never" : "auto");
  return {
    applePay: vis("apple_pay"),
    googlePay: vis("google_pay"),
    link: vis("link"),
    paypal: "never",
    amazonPay: vis("amazon_pay"),
    klarna: vis("klarna"),
  };
}

/**
 * Args for Checkout `confirm()`.
 * Apple Pay / Google Pay / Link / Amazon Pay / Klarna must pass the Express
 * Checkout event. The card Payment Element Pay button confirms without it.
 */
export function checkoutConfirmOptions<T>(event?: T): {
  redirect: "if_required";
  expressCheckoutConfirmEvent?: T;
} {
  return {
    redirect: "if_required",
    ...(event ? { expressCheckoutConfirmEvent: event } : {}),
  };
}

export function confirmUsesExpressEvent(method: ExpressCheckoutMethod | "card"): boolean {
  return method !== "card";
}
