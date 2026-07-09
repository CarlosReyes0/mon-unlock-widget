/** Shared protocol between <mon-unlock> and the hosted Privy checkout page. */

export const CHECKOUT_MESSAGE_SOURCE = "mon-unlock-checkout" as const;

export const DEFAULT_CHECKOUT_ORIGIN = "https://mon-unlock-widget-production.up.railway.app";

export type CheckoutUnlockedMessage = {
  source: typeof CHECKOUT_MESSAGE_SOURCE;
  type: "mon:unlocked";
  articleId: string;
  address: string;
  txHash?: string;
};

export type CheckoutClosedMessage = {
  source: typeof CHECKOUT_MESSAGE_SOURCE;
  type: "mon:checkout-closed";
  articleId: string;
  reason?: string;
};

export type CheckoutMessage = CheckoutUnlockedMessage | CheckoutClosedMessage;

export type CheckoutParams = {
  articleId: string;
  title: string;
  price: string;
  contract: string;
  embedSig: string;
  parentOrigin: string;
};

export function getCheckoutBaseUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_CHECKOUT_ORIGIN) {
    return String(import.meta.env.VITE_CHECKOUT_ORIGIN).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    // When the widget is loaded from our CDN, prefer that origin for checkout.
    try {
      const scripts = Array.from(document.getElementsByTagName("script"));
      const self = scripts.find((s) => s.src && s.src.includes("/dist/mon-unlock.js"));
      if (self?.src) {
        return new URL(self.src).origin;
      }
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_CHECKOUT_ORIGIN;
}

export function buildCheckoutUrl(params: CheckoutParams, baseUrl = getCheckoutBaseUrl()): string {
  const url = new URL("/unlock.html", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("articleId", params.articleId);
  url.searchParams.set("title", params.title);
  url.searchParams.set("price", params.price);
  url.searchParams.set("contract", params.contract);
  if (params.embedSig) url.searchParams.set("embedSig", params.embedSig);
  url.searchParams.set("parentOrigin", params.parentOrigin);
  return url.toString();
}

export function isCheckoutMessage(data: unknown): data is CheckoutMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Partial<CheckoutMessage>;
  if (msg.source !== CHECKOUT_MESSAGE_SOURCE) return false;
  if (msg.type === "mon:unlocked") {
    return typeof msg.articleId === "string" && typeof msg.address === "string";
  }
  if (msg.type === "mon:checkout-closed") {
    return typeof msg.articleId === "string";
  }
  return false;
}

export function postCheckoutMessage(
  target: Window | null | undefined,
  targetOrigin: string,
  message: CheckoutMessage
): void {
  if (!target || !targetOrigin) return;
  target.postMessage(message, targetOrigin);
}
