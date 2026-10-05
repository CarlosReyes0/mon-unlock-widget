/**
 * Checkout charge from a stored article price.
 * Keep the minimum and USDC conversion in sync with src/core/article-price.ts.
 * Stored price_cents has no product maximum. A client-supplied amount, used
 * only when the row has no price_cents, still rejects anything over $1,000.
 */

export const MIN_ARTICLE_PRICE_CENTS = 50;
const CLIENT_AMOUNT_MAX_CENTS = 100_000;

/** @param {unknown} value */
export function storedPriceCents(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n < MIN_ARTICLE_PRICE_CENTS) return null;
  return n;
}

/**
 * @param {{ price_cents?: unknown } | null | undefined} article
 * @param {unknown} requestedCents
 * @returns {{ ok: true, cents: number, source: "price_cents" | "request" } | { ok: false, error: "invalid_amount" | "amount_too_large" }}
 */
export function resolveUnlockChargeCents(article, requestedCents) {
  const raw = article?.price_cents;
  if (raw != null && raw !== "") {
    const stored = storedPriceCents(raw);
    if (stored == null) return { ok: false, error: "invalid_amount" };
    return { ok: true, cents: stored, source: "price_cents" };
  }
  const amount = Math.round(Number(requestedCents));
  if (!Number.isFinite(amount) || amount < MIN_ARTICLE_PRICE_CENTS) {
    return { ok: false, error: "invalid_amount" };
  }
  if (amount > CLIENT_AMOUNT_MAX_CENTS) return { ok: false, error: "amount_too_large" };
  return { ok: true, cents: amount, source: "request" };
}
