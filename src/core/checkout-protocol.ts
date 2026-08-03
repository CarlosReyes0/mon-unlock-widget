/** Shared protocol between the embed widget and the hosted checkout page. */

/** Canonical source sent by checkout — keep stable so older widgets keep working. */
export const CHECKOUT_MESSAGE_SOURCE = "mon-unlock-checkout" as const;

/** Accepted sources when receiving postMessage (legacy + Open Paywall). */
export const CHECKOUT_MESSAGE_SOURCES = [
  CHECKOUT_MESSAGE_SOURCE,
  "openpaywall-checkout",
] as const;

export type CheckoutMessageSource = (typeof CHECKOUT_MESSAGE_SOURCES)[number];

export const DEFAULT_CHECKOUT_ORIGIN = "https://mon-unlock-widget-production.up.railway.app";

/** Query params written onto the article URL after a successful fiat pay (mobile / same-tab). */
export const FIAT_SESSION_PARAM = "mon_fiat_session";
export const FIAT_ARTICLE_PARAM = "mon_article_id";

const WIDGET_SCRIPT_MARKERS = ["/dist/mon-unlock.js", "/dist/openpaywall.js"] as const;

export type CheckoutUnlockedMessage = {
  source: CheckoutMessageSource;
  type: "mon:unlocked";
  articleId: string;
  /** On-chain / Privy path */
  address?: string;
  txHash?: string;
  /** Stripe fiat path — session token proves entitlement in Supabase */
  fiatSession?: string;
  mode?: "onchain" | "fiat";
};

export type CheckoutClosedMessage = {
  source: CheckoutMessageSource;
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
  /** Full article page URL — used to send mobile / same-tab users back after pay. */
  returnUrl?: string;
};

export function getCheckoutBaseUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_CHECKOUT_ORIGIN) {
    return String(import.meta.env.VITE_CHECKOUT_ORIGIN).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    // When the widget is loaded from our CDN, prefer that origin for checkout.
    try {
      const scripts = Array.from(document.getElementsByTagName("script"));
      const self = scripts.find(
        (s) => s.src && WIDGET_SCRIPT_MARKERS.some((marker) => s.src.includes(marker))
      );
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
  if (params.returnUrl) {
    try {
      const ret = new URL(params.returnUrl);
      if (ret.protocol === "http:" || ret.protocol === "https:") {
        url.searchParams.set("returnUrl", ret.toString());
      }
    } catch {
      /* ignore invalid returnUrl */
    }
  }
  return url.toString();
}

/** Article URL + fiat session so the widget can unlock after a same-tab mobile checkout. */
export function buildArticleReturnUrl(
  returnUrl: string,
  params: { articleId: string; fiatSession: string }
): string {
  const url = new URL(returnUrl);
  url.searchParams.set(FIAT_SESSION_PARAM, params.fiatSession);
  url.searchParams.set(FIAT_ARTICLE_PARAM, params.articleId);
  return url.toString();
}

export function readFiatReturnFromLocation(
  search = typeof window !== "undefined" ? window.location.search : ""
): {
  articleId: string;
  fiatSession: string;
} | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fiatSession = params.get(FIAT_SESSION_PARAM)?.trim() ?? "";
  const articleId = params.get(FIAT_ARTICLE_PARAM)?.trim() ?? "";
  if (!fiatSession || !articleId) return null;
  return { articleId, fiatSession };
}

/** Remove fiat return params from the address bar without reloading. */
export function clearFiatReturnParams(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(FIAT_SESSION_PARAM) && !url.searchParams.has(FIAT_ARTICLE_PARAM)) {
      return;
    }
    url.searchParams.delete(FIAT_SESSION_PARAM);
    url.searchParams.delete(FIAT_ARTICLE_PARAM);
    window.history.replaceState({}, "", url.toString());
  } catch {
    /* ignore */
  }
}

function isAcceptedCheckoutSource(source: unknown): source is CheckoutMessageSource {
  return (
    typeof source === "string" &&
    (CHECKOUT_MESSAGE_SOURCES as readonly string[]).includes(source)
  );
}

export function isCheckoutMessage(data: unknown): data is CheckoutMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Partial<CheckoutMessage>;
  if (!isAcceptedCheckoutSource(msg.source)) return false;
  if (msg.type === "mon:unlocked") {
    if (typeof msg.articleId !== "string") return false;
    const hasAddress = typeof msg.address === "string" && msg.address.length > 0;
    const hasFiat = typeof msg.fiatSession === "string" && msg.fiatSession.length > 0;
    return hasAddress || hasFiat;
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
