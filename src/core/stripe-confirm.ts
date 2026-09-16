/** Wallet buttons that go through Express Checkout Element `onConfirm(event)`. */
export const EXPRESS_CHECKOUT_METHODS = [
  "applePay",
  "googlePay",
  "link",
  "amazonPay",
  "klarna",
] as const;

export type ExpressCheckoutMethod = (typeof EXPRESS_CHECKOUT_METHODS)[number];

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
